// Pure checks: no database needed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { signPass } = require("./helpers");
const { verifyHordeMartPass, signBody, verifyBodySignature } = require("../lib/hordemartSso");
const { signupSchema, saleEventSchema, loginSchema } = require("../validation/schemas");
const { CONSENT_VERSIONS } = require("../legal/versions");
const { stockBySku } = require("../services/hordemartStock");
const { createRateLimiter } = require("../lib/rateLimit");

const SECRET = process.env.HORDEMART_SSO_SECRET;

test("a correctly signed pass is accepted", () => {
  const { token, claims } = signPass();
  assert.equal(verifyHordeMartPass(token, SECRET)?.jti, claims.jti);
});

test("passes that are not exactly right are refused", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(verifyHordeMartPass(signPass({}, { header: { alg: "none" } }).token, SECRET), null, "alg none");
  assert.equal(verifyHordeMartPass(signPass({}, { header: { alg: "HS512" } }).token, SECRET), null, "other alg");
  assert.equal(verifyHordeMartPass(signPass({}, { secret: "x".repeat(48) }).token, SECRET), null, "wrong key");
  assert.equal(verifyHordeMartPass(signPass({ exp: now - 1 }).token, SECRET), null, "expired");
  assert.equal(verifyHordeMartPass(signPass({ iat: now + 120 }).token, SECRET), null, "issued in the future");
  assert.equal(verifyHordeMartPass(signPass({ aud: "someone-else" }).token, SECRET), null, "wrong audience");
  assert.equal(verifyHordeMartPass(signPass({ iss: "evil" }).token, SECRET), null, "wrong issuer");
  assert.equal(verifyHordeMartPass(signPass({ jti: "" }).token, SECRET), null, "no jti");
  assert.equal(verifyHordeMartPass(signPass({ site: {} }).token, SECRET), null, "no store");
  assert.equal(verifyHordeMartPass("not-a-token", SECRET), null);

  const { token } = signPass();
  const [h, , s] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...signPass().claims, sub: "someone-else" })).toString("base64url");
  assert.equal(verifyHordeMartPass(`${h}.${forged}.${s}`, SECRET), null, "tampered claims");
});

test("a missing or short secret is a configuration error, not a pass", () => {
  assert.throws(() => verifyHordeMartPass(signPass().token, "short"));
});

test("body signatures: exact bytes, five-minute window", () => {
  const secret = process.env.HORDEMART_WEBHOOK_SECRET;
  const body = JSON.stringify({ a: 1 });
  const now = Date.now();
  const header = signBody(body, secret, now);
  assert.equal(verifyBodySignature(body, header, secret, now), true);
  assert.equal(verifyBodySignature(body + " ", header, secret, now), false, "changed body");
  assert.equal(verifyBodySignature(body, header, "y".repeat(48), now), false, "wrong secret");
  assert.equal(verifyBodySignature(body, header, secret, now + 301_000), false, "too old");
  assert.equal(verifyBodySignature(body, "t=1,v1=zz", secret, now), false, "garbage");
  assert.equal(verifyBodySignature(body, header, "", now), false, "no secret");
});

test("sign-up needs the Terms ticked, the current version and a 12-character password", () => {
  const ok = {
    email: " Ade@Example.com ",
    name: "Ade",
    password: "correct-horse-battery",
    acceptTerms: true,
    termsVersion: CONSENT_VERSIONS.terms,
    business: { businessName: "Ade Textiles" },
  };
  const parsed = signupSchema.safeParse(ok);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.email, "ade@example.com");
  assert.equal(signupSchema.safeParse({ ...ok, acceptTerms: undefined }).success, false);
  assert.equal(signupSchema.safeParse({ ...ok, acceptTerms: "true" }).success, false);
  assert.equal(signupSchema.safeParse({ ...ok, termsVersion: "2020-01-01" }).success, false);
  assert.equal(signupSchema.safeParse({ ...ok, password: "elevenchars" }).success, false);
  assert.equal(signupSchema.safeParse({ ...ok, business: {} }).success, false);
  // Old accounts keep signing in with their old, shorter passwords.
  assert.equal(loginSchema.safeParse({ email: "a@b.co", password: "short" }).success, true);
});

test("sale events: whole positive quantities, no more than 500 lines", () => {
  const ok = { event: "order.paid", siteId: "s", orderNumber: "HM-1", items: [{ sku: "A", quantity: 2 }] };
  assert.equal(saleEventSchema.safeParse(ok).success, true);
  assert.equal(saleEventSchema.safeParse({ ...ok, items: [{ sku: "A", quantity: 1.5 }] }).success, false);
  assert.equal(saleEventSchema.safeParse({ ...ok, items: [{ sku: "A", quantity: -1 }] }).success, false);
  assert.equal(saleEventSchema.safeParse({ ...ok, items: [] }).success, false);
  assert.equal(saleEventSchema.safeParse({ ...ok, event: "order.refunded" }).success, false);
  assert.equal(
    saleEventSchema.safeParse({ ...ok, items: Array.from({ length: 501 }, (_, i) => ({ sku: `S${i}`, quantity: 1 })) }).success,
    false
  );
});

test("stock by SKU: absolute whole counts, never negative, codes trimmed", () => {
  const load = (amount) => ({ type: "load", amount });
  const off = (amount) => ({ type: "offload", amount });
  const items = stockBySku([
    { sku: " RICE ", entries: [load(10), off(3)] },
    { sku: "RICE", entries: [load(2)] },
    { sku: "OIL", entries: [load(1), off(4)] },
    { sku: "", entries: [load(5)] },
    { entries: [load(5)] },
    { sku: "X".repeat(65), entries: [load(1)] },
    { sku: "HALF", entries: [load(2.7)] },
  ]);
  assert.deepEqual(items, [
    { sku: "RICE", quantity: 9 },
    { sku: "OIL", quantity: 0 },
    { sku: "HALF", quantity: 2 },
  ]);
});

test("the rate limiter answers 429 with Retry-After once the limit is passed", () => {
  let t = 0;
  const limiter = createRateLimiter({ name: "t", limit: 2, windowMs: 60_000, now: () => t });
  const run = () => {
    const res = {
      code: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.code = c; return this; },
      json() { return this; },
    };
    let passed = false;
    limiter({ ip: "1.2.3.4" }, res, () => { passed = true; });
    return { passed, res };
  };
  assert.equal(run().passed, true);
  assert.equal(run().passed, true);
  const third = run();
  assert.equal(third.passed, false);
  assert.equal(third.res.code, 429);
  assert.equal(third.res.headers["Retry-After"], "60");
  t = 60_001;
  assert.equal(run().passed, true, "a new window starts fresh");
});

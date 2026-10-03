// The bot server only acts for the signed-in person's own business, and
// only sends over Telegram/WhatsApp once they have agreed. No network: the
// main backend is faked.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { requireCompanyUser, _resetAuthCaches } from "../src/appAuth.js";

process.env.BOT_API_KEY = "server-only-key";

const VERSIONS = { telegram: "2026-10-02", whatsapp: "2026-10-02" };

function fakeBackend({ users = {}, consents = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    const token = (init.headers.Authorization || "").slice(7);
    const user = users[token];
    if (!user) return { status: 401, ok: false, json: async () => ({}) };
    if (url.endsWith("/api/users/me")) return { status: 200, ok: true, json: async () => ({ user }) };
    if (url.endsWith("/api/consents")) {
      return { status: 200, ok: true, json: async () => ({ consents: consents[token] || [], versions: VERSIONS }) };
    }
    return { status: 404, ok: false, json: async () => ({}) };
  };
  return { fetchImpl, calls };
}

async function run(middleware, { headers = {}, body = {}, query = {} } = {}) {
  const req = { body, query, header: (name) => headers[name.toLowerCase()] };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.payload = data; return this; },
  };
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

const ade = { id: "u1", businessId: "biz-ade", role: "owner" };

beforeEach(() => _resetAuthCaches());

test("the old public app key alone is refused", async () => {
  const { fetchImpl } = fakeBackend();
  const out = await run(requireCompanyUser({ fetchImpl }), {
    headers: { "x-bot-api-key": "server-only-key" },
    body: { companyId: "biz-ade" },
  });
  assert.equal(out.nextCalled, false);
  assert.equal(out.res.statusCode, 401);
});

test("a signed-in person acts for their own business", async () => {
  const { fetchImpl } = fakeBackend({ users: { t1: ade } });
  const out = await run(requireCompanyUser({ fetchImpl }), {
    headers: { authorization: "Bearer t1" },
    query: { companyId: "biz-ade" },
  });
  assert.equal(out.nextCalled, true);
  assert.equal(out.req.appUser.id, "u1");
});

test("…and never for someone else's", async () => {
  const { fetchImpl } = fakeBackend({ users: { t1: ade } });
  const out = await run(requireCompanyUser({ fetchImpl }), {
    headers: { authorization: "Bearer t1" },
    body: { companyId: "biz-someone-else" },
  });
  assert.equal(out.nextCalled, false);
  assert.equal(out.res.statusCode, 403);
});

test("a bad or expired token is refused", async () => {
  const { fetchImpl } = fakeBackend({ users: { t1: ade } });
  const out = await run(requireCompanyUser({ fetchImpl }), {
    headers: { authorization: "Bearer forged" },
    body: { companyId: "biz-ade" },
  });
  assert.equal(out.res.statusCode, 401);
});

test("sending needs the current agreement for that channel", async () => {
  const backend = fakeBackend({
    users: { t1: ade, t2: ade, t3: ade },
    consents: {
      t2: [{ purpose: "whatsapp", version: VERSIONS.whatsapp }],
      t3: [{ purpose: "whatsapp", version: "2020-01-01" }],
    },
  });
  const guard = requireCompanyUser({ consent: "whatsapp", fetchImpl: backend.fetchImpl });
  const none = await run(guard, { headers: { authorization: "Bearer t1" }, body: { companyId: "biz-ade" } });
  assert.equal(none.res.statusCode, 403);
  assert.equal(none.res.payload.code, "CONSENT_REQUIRED");
  const old = await run(guard, { headers: { authorization: "Bearer t3" }, body: { companyId: "biz-ade" } });
  assert.equal(old.res.statusCode, 403, "an older version does not count");
  const agreed = await run(guard, { headers: { authorization: "Bearer t2" }, body: { companyId: "biz-ade" } });
  assert.equal(agreed.nextCalled, true);
});

test("the channel can come from the request (statements)", async () => {
  const { fetchImpl } = fakeBackend({
    users: { t1: ade },
    consents: { t1: [{ purpose: "telegram", version: VERSIONS.telegram }] },
  });
  const guard = requireCompanyUser({ consent: (req) => req.body.channel, fetchImpl });
  const tg = await run(guard, { headers: { authorization: "Bearer t1" }, body: { companyId: "biz-ade", channel: "telegram" } });
  assert.equal(tg.nextCalled, true);
  const wa = await run(guard, { headers: { authorization: "Bearer t1" }, body: { companyId: "biz-ade", channel: "whatsapp" } });
  assert.equal(wa.res.statusCode, 403);
});

test("an unreachable main server fails closed", async () => {
  const fetchImpl = async () => { throw new Error("ECONNREFUSED"); };
  const out = await run(requireCompanyUser({ fetchImpl }), {
    headers: { authorization: "Bearer t1" },
    body: { companyId: "biz-ade" },
  });
  assert.equal(out.nextCalled, false);
  assert.equal(out.res.statusCode, 503);
});

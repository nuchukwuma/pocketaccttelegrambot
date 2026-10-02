// Sign-up, consents, the HordeMart link, sales and stock — against a real
// MongoDB (MONGO_TEST_URI). Skipped, with a notice, when there is none.
const { describe, test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const helpers = require("./helpers");
const { skipWithoutDb, connectTestDb, disconnectTestDb, buildTestApp, listen, signPass, resetLimits } = helpers;
const { CONSENT_VERSIONS } = require("../legal/versions");
const { signBody } = require("../lib/hordemartSso");

describe("Mr Mouse backend", { skip: skipWithoutDb }, () => {
  let api, io, models;

  before(async () => {
    models = {
      User: require("../models/User"),
      Business: require("../models/Business"),
      Consent: require("../models/Consent"),
      EntitySnapshot: require("../models/EntitySnapshot"),
      ...require("../models/HordeMart"),
    };
    await connectTestDb("backend");
    ({ io } = (() => {
      const built = buildTestApp();
      api = built.app;
      return built;
    })());
    api = await listen(api);
  });

  after(async () => {
    await api.close();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    resetLimits();
    await Promise.all(
      ["User", "Business", "EntitySnapshot", "UsedPass", "SsoTicket", "HordeMartLink", "HordeMartSale"].map((m) =>
        models[m].deleteMany({})
      )
    );
    // Consent is append-only by design; clear it underneath the model.
    await models.Consent.collection.deleteMany({});
  });

  const signupBody = (overrides = {}) => ({
    email: "owner@example.com",
    name: "Owner",
    password: "correct-horse-battery",
    acceptTerms: true,
    termsVersion: CONSENT_VERSIONS.terms,
    business: { businessName: "Owner Ltd" },
    ...overrides,
  });

  async function signUp(overrides) {
    const res = await api.call("POST", "/api/users", { body: signupBody(overrides) });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    return res.data;
  }

  describe("sign-up", () => {
    test("refuses without the Terms ticked, with an old version, or a short password", async () => {
      for (const body of [
        signupBody({ acceptTerms: false }),
        signupBody({ acceptTerms: undefined }),
        signupBody({ termsVersion: "2001-01-01" }),
        signupBody({ password: "short-pass" }),
      ]) {
        const res = await api.call("POST", "/api/users", { body });
        assert.equal(res.status, 400, JSON.stringify(body));
      }
      assert.equal(await models.User.countDocuments(), 0);
    });

    test("creates the business and records which Terms were accepted", async () => {
      const data = await signUp();
      assert.ok(data.token);
      assert.equal(data.user.passwordHash, undefined);
      const consent = await models.Consent.findOne({ userId: data.user.id }).lean();
      assert.equal(consent.purpose, "terms");
      assert.equal(consent.version, CONSENT_VERSIONS.terms);
      assert.equal(consent.source, "signup");
    });

    test("sign-in attempts for one email are limited", async () => {
      await signUp();
      let last;
      for (let i = 0; i < 11; i++) {
        last = await api.call("POST", "/api/users/login", { body: { email: "owner@example.com", password: "wrong" } });
      }
      assert.equal(last.status, 429);
      assert.ok(last.headers.get("retry-after"));
    });
  });

  describe("consents", () => {
    test("accept, list, withdraw — and only the current version counts", async () => {
      const { token } = await signUp();
      const stale = await api.call("POST", "/api/consents", { token, body: { purpose: "ai", version: "1999-01-01", accept: true } });
      assert.equal(stale.status, 409);

      const ok = await api.call("POST", "/api/consents", { token, body: { purpose: "ai", version: CONSENT_VERSIONS.ai, accept: true } });
      assert.equal(ok.status, 201);
      let list = await api.call("GET", "/api/consents", { token });
      assert.deepEqual(list.data.consents.map((c) => c.purpose).sort(), ["ai", "terms"]);
      assert.equal(list.data.versions.ai, CONSENT_VERSIONS.ai);

      assert.equal((await api.call("DELETE", "/api/consents/ai", { token })).status, 200);
      list = await api.call("GET", "/api/consents", { token });
      assert.deepEqual(list.data.consents.map((c) => c.purpose), ["terms"]);
      assert.equal(await models.Consent.countDocuments(), 3, "withdrawal is a new row, nothing deleted");

      assert.equal((await api.call("DELETE", "/api/consents/terms", { token })).status, 422);
      assert.equal((await api.call("POST", "/api/consents", { body: { purpose: "ai", version: CONSENT_VERSIONS.ai, accept: true } })).status, 401);
    });

    test("consent rows cannot be edited or deleted through the model", async () => {
      await signUp();
      await assert.rejects(models.Consent.updateOne({}, { $set: { version: "x" } }));
      await assert.rejects(models.Consent.deleteMany({}));
    });

    test("the AI assistant refuses until the AI consent is given", async () => {
      const { token } = await signUp();
      const res = await api.call("POST", "/api/ai/chat", { token, body: { message: "hello" } });
      assert.equal(res.status, 403);
      assert.equal(res.data.code, "CONSENT_REQUIRED");
    });
  });

  describe("HordeMart sign-in", () => {
    const linkFor = (body) =>
      api.call("POST", "/api/integrations/hordemart/sso/confirm", {
        body: {
          acceptTerms: true,
          termsVersion: CONSENT_VERSIONS.hordemart,
          acceptAppTerms: true,
          appTermsVersion: CONSENT_VERSIONS.terms,
          ...body,
        },
      });

    test("first visit: consent, then a new business; next visit goes straight in", async () => {
      const first = await api.call("POST", "/api/integrations/hordemart/sso", { body: { token: signPass().token } });
      assert.equal(first.status, 200);
      assert.equal(first.data.status, "consent_required");
      assert.equal(first.data.existingAccount, false);

      const refused = await linkFor({ ticket: first.data.ticket, acceptTerms: false });
      assert.equal(refused.status, 400, "no tick, no link");

      const linked = await linkFor({ ticket: first.data.ticket });
      assert.equal(linked.status, 200, JSON.stringify(linked.data));
      assert.equal(linked.data.status, "signed_in");
      assert.ok(linked.data.token);
      const user = await models.User.findOne({ email: "ade@example.com" }).lean();
      assert.equal(user.role, "owner");
      assert.equal((await models.Business.findOne({ id: user.businessId }).lean()).businessName, "Ade Textiles");
      const link = await models.HordeMartLink.findOne({ hordemartUserId: "hm-user-1" }).lean();
      assert.equal(link.siteId, "site-1");
      assert.equal(link.hordemartRole, "owner");
      assert.deepEqual(
        (await models.Consent.find({ userId: user.id }).lean()).map((c) => c.purpose).sort(),
        ["hordemart", "terms"]
      );

      assert.equal((await linkFor({ ticket: first.data.ticket })).status, 401, "a ticket works once");

      const again = await api.call("POST", "/api/integrations/hordemart/sso", { body: { token: signPass().token } });
      assert.equal(again.data.status, "signed_in");
      assert.equal(await models.User.countDocuments(), 1);
    });

    test("a pass works once, and only if HordeMart confirmed the email", async () => {
      const { token } = signPass();
      assert.equal((await api.call("POST", "/api/integrations/hordemart/sso", { body: { token } })).status, 200);
      assert.equal((await api.call("POST", "/api/integrations/hordemart/sso", { body: { token } })).status, 401);
      const unverified = signPass({ email_verified: false }).token;
      assert.equal((await api.call("POST", "/api/integrations/hordemart/sso", { body: { token: unverified } })).status, 403);
      assert.equal((await api.call("POST", "/api/integrations/hordemart/sso", { body: { token: "nonsense" } })).status, 401);
    });

    test("an existing account with the confirmed email is linked, not duplicated", async () => {
      const owner = await signUp({ email: "ade@example.com" });
      const first = await api.call("POST", "/api/integrations/hordemart/sso", { body: { token: signPass().token } });
      assert.equal(first.data.existingAccount, true);
      const linked = await linkFor({ ticket: first.data.ticket });
      assert.equal(linked.data.user.id, owner.user.id);
      assert.equal(await models.Business.countDocuments(), 1);
    });

    test("store staff without a Mr Mouse account are sent to their owner", async () => {
      const res = await api.call("POST", "/api/integrations/hordemart/sso", {
        body: { token: signPass({ role: "staff", sub: "hm-staff", email: "staff@example.com" }).token },
      });
      assert.equal(res.status, 403);
      assert.equal(await models.User.countDocuments(), 0);
    });

    test("an account made from HordeMart can choose a password, then sign in with it anywhere", async () => {
      const first = await api.call("POST", "/api/integrations/hordemart/sso", { body: { token: signPass().token } });
      const { token, user } = (await linkFor({ ticket: first.data.ticket })).data;
      assert.equal(user.passwordSet, false);
      assert.equal((await api.call("POST", "/api/users/me/password", { token, body: { newPassword: "short" } })).status, 400);

      const set = await api.call("POST", "/api/users/me/password", { token, body: { newPassword: "a-long-new-password" } });
      assert.equal(set.status, 200, JSON.stringify(set.data));
      assert.equal(set.data.user.passwordSet, true);
      const login = await api.call("POST", "/api/users/login", { body: { email: "ade@example.com", password: "a-long-new-password" } });
      assert.equal(login.status, 200);

      // From now on, changing it needs the current one.
      const noCurrent = await api.call("POST", "/api/users/me/password", { token, body: { newPassword: "another-long-password" } });
      assert.equal(noCurrent.status, 403);
      const wrong = await api.call("POST", "/api/users/me/password", { token, body: { currentPassword: "nope", newPassword: "another-long-password" } });
      assert.equal(wrong.status, 403);
      const right = await api.call("POST", "/api/users/me/password", {
        token,
        body: { currentPassword: "a-long-new-password", newPassword: "another-long-password" },
      });
      assert.equal(right.status, 200);
    });

    test("withdrawing the HordeMart consent unlinks; the next visit asks again", async () => {
      const first = await api.call("POST", "/api/integrations/hordemart/sso", { body: { token: signPass().token } });
      const { token } = (await linkFor({ ticket: first.data.ticket })).data;
      assert.equal((await api.call("DELETE", "/api/consents/hordemart", { token })).status, 200);
      assert.equal(await models.HordeMartLink.countDocuments(), 0);
      const next = await api.call("POST", "/api/integrations/hordemart/sso", { body: { token: signPass().token } });
      assert.equal(next.data.status, "consent_required");
    });
  });

  describe("sales and stock", () => {
    async function linkedOwnerWithProduct({ sku = "ADIRE-01", stock = 10 } = {}) {
      const first = await api.call("POST", "/api/integrations/hordemart/sso", { body: { token: signPass().token } });
      const { user } = (await api.call("POST", "/api/integrations/hordemart/sso/confirm", {
        body: {
          ticket: first.data.ticket,
          acceptTerms: true,
          termsVersion: CONSENT_VERSIONS.hordemart,
          acceptAppTerms: true,
          appTermsVersion: CONSENT_VERSIONS.terms,
        },
      })).data;
      const payload = { id: "p1", name: "Adire", sku, companyId: user.businessId, entries: [{ id: "e1", type: "load", amount: stock, date: "2026-10-01" }] };
      await models.EntitySnapshot.create({ businessId: user.businessId, entity: "product", entityId: "p1", payload });
      return user;
    }

    const sale = (overrides = {}) =>
      JSON.stringify({
        event: "order.paid",
        siteId: "site-1",
        orderNumber: "HM-1001",
        paidAt: "2026-10-02T09:00:00.000Z",
        items: [{ sku: "ADIRE-01", quantity: 2 }, { sku: "NOT-HERE", quantity: 1 }],
        ...overrides,
      });
    const post = (raw, secret = process.env.HORDEMART_WEBHOOK_SECRET) =>
      api.call("POST", "/integrations/hordemart/sales", { raw, headers: { "X-HordeMart-Signature": signBody(raw, secret) } });

    test("a signed sale becomes an offload on the product with that item code, once", async () => {
      const user = await linkedOwnerWithProduct();
      const body = sale();

      assert.equal((await post(body, "x".repeat(48))).status, 401, "wrong signature");
      assert.equal((await api.call("POST", "/integrations/hordemart/sales", { raw: body })).status, 401, "no signature");

      const res = await post(body);
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.deepEqual(res.data.results, [{ applied: ["ADIRE-01"], unknownSkus: ["NOT-HERE"] }]);

      const row = await models.EntitySnapshot.findOne({ businessId: user.businessId, entityId: "p1" }).lean();
      const entry = row.payload.entries.at(-1);
      assert.equal(entry.type, "offload");
      assert.equal(entry.amount, 2);
      assert.equal(entry.date, "2026-10-02");
      assert.match(entry.note, /HM-1001/);
      assert.ok(io.emitted.some((e) => e.event === "SYNC_EVENT" && e.room === `company_${user.businessId}`), "open devices hear about it");

      const repeat = await post(body);
      assert.equal(repeat.data.duplicate, true);
      const after = await models.EntitySnapshot.findOne({ businessId: user.businessId, entityId: "p1" }).lean();
      assert.equal(after.payload.entries.length, 2);
    });

    test("malformed sales are refused", async () => {
      await linkedOwnerWithProduct();
      assert.equal((await post(sale({ items: [{ sku: "A", quantity: 0.5 }] }))).status, 422);
      assert.equal((await post("{not json")).status, 422);
    });

    test("stock push: signed, absolute counts by SKU; a 409 pauses it", async () => {
      const { pushBusinessStock } = require("../services/hordemartStock");
      const { verifyBodySignature } = require("../lib/hordemartSso");
      const user = await linkedOwnerWithProduct({ stock: 7 });
      const sent = [];
      let answer = 200;
      const fetchImpl = async (url, init) => {
        sent.push({ url, init });
        return { status: answer, json: async () => ({}) };
      };

      assert.deepEqual(await pushBusinessStock(user.businessId, { fetchImpl }), { pushed: 1 });
      assert.equal(sent[0].url, "https://hordemart.test/api/integrations/mrmouse/inventory");
      const body = JSON.parse(sent[0].init.body);
      assert.equal(body.siteId, "site-1");
      assert.deepEqual(body.items, [{ sku: "ADIRE-01", quantity: 7 }]);
      assert.equal(
        verifyBodySignature(sent[0].init.body, sent[0].init.headers["X-MrMouse-Signature"], process.env.HORDEMART_WEBHOOK_SECRET),
        true
      );

      answer = 409;
      await pushBusinessStock(user.businessId, { fetchImpl });
      const link = await models.HordeMartLink.findOne({}).lean();
      assert.ok(link.stockSyncPausedUntil > new Date());
      assert.deepEqual(await pushBusinessStock(user.businessId, { fetchImpl }), { pushed: 0, reason: "no_link" });
    });

    test("no push once the HordeMart consent is withdrawn", async () => {
      const { pushBusinessStock } = require("../services/hordemartStock");
      const user = await linkedOwnerWithProduct();
      const { withdrawConsent } = require("../services/consents");
      await withdrawConsent({ user, purpose: "hordemart" });
      let calls = 0;
      const result = await pushBusinessStock(user.businessId, { fetchImpl: async () => { calls++; return { status: 200, json: async () => ({}) }; } });
      assert.equal(result.pushed, 0);
      assert.equal(calls, 0);
    });
  });
});

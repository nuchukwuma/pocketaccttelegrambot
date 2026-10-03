// Images and preferences over the real sync server: two "devices" on
// sockets, plus a third that joins later. Needs MONGO_TEST_URI.
const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { io } = require("socket.io-client");
const { CONSENT_VERSIONS } = require("../legal/versions");

const MONGO_TEST_URI = process.env.MONGO_TEST_URI || "";
const PORT = 5600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_URI = MONGO_TEST_URI.replace(/\/[^/?]*(\?|$)/, `/mrmouse_test_sync_${process.pid}$1`);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tinyWebp = () => crypto.randomBytes(2048).toString("base64"); // stand-in bytes; the server checks shape, not pixels

describe("sync: images and preferences", { skip: MONGO_TEST_URI ? false : "MONGO_TEST_URI is not set" }, () => {
  let server, token, businessId;
  const sockets = [];

  async function connect() {
    const socket = io(BASE, { transports: ["websocket"], auth: { token }, forceNew: true });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.on("connect", resolve);
      socket.on("connect_error", reject);
    });
    const joined = new Promise((resolve) => socket.once("JOINED_COMPANY", resolve));
    socket.emit("JOIN_COMPANY", { companyId: businessId });
    await joined;
    return socket;
  }

  const collect = (socket, event) => {
    const seen = [];
    socket.on(event, (msg) => seen.push(msg));
    return seen;
  };

  before(async () => {
    server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
      env: { ...process.env, PORT: String(PORT), MONGO_URI: DB_URI, AUTH_SECRET: crypto.randomBytes(32).toString("hex") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("server did not start")), 20000);
      server.stdout.on("data", (chunk) => {
        if (String(chunk).includes("listening")) {
          clearTimeout(timer);
          resolve();
        }
      });
      server.on("exit", (code) => reject(new Error(`server exited ${code}`)));
    });
    const res = await fetch(`${BASE}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "sync@example.com",
        name: "Sync Owner",
        password: "correct-horse-battery",
        acceptTerms: true,
        termsVersion: CONSENT_VERSIONS.terms,
        business: { businessName: "Sync Ltd" },
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 201, JSON.stringify(data));
    token = data.token;
    businessId = data.user.businessId;
  });

  after(async () => {
    for (const s of sockets) s.disconnect();
    server?.kill();
    const conn = await mongoose.createConnection(DB_URI).asPromise();
    await conn.dropDatabase();
    await conn.close();
  });

  test("an image reaches the other device; an oversized or odd one is refused", async () => {
    const a = await connect();
    const b = await connect();
    const onB = collect(b, "SYNC_EVENT");
    const refusedOnA = collect(a, "SYNC_REJECTED");

    const good = { id: "img-1", kind: "logo", mime: "image/webp", width: 64, height: 64, bytes: 2048, data: tinyWebp(), updatedAt: new Date().toISOString() };
    a.emit("SYNC_MUTATE", { companyId: businessId, entity: "image", action: "create", id: good.id, payload: good });
    a.emit("SYNC_MUTATE", { companyId: businessId, entity: "image", action: "create", id: "img-big", payload: { ...good, id: "img-big", data: "A".repeat(230 * 1024) } });
    a.emit("SYNC_MUTATE", { companyId: businessId, entity: "image", action: "create", id: "img-svg", payload: { ...good, id: "img-svg", mime: "image/svg+xml" } });
    await wait(600);

    assert.deepEqual(onB.map((e) => e.payload.id), ["img-1"]);
    assert.equal(onB[0].payload.data, good.data, "bytes arrive intact");
    assert.deepEqual(refusedOnA.map((r) => [r.id, r.reason]).sort(), [["img-big", "image too large"], ["img-svg", "unsupported image type"]]);
  });

  test("a device joining later gets images one per message, never inside the bulk snapshot", async () => {
    const a = sockets[0];
    a.emit("SYNC_MUTATE", { companyId: businessId, entity: "pref", action: "update", id: `${businessId}:theme`, payload: { id: `${businessId}:theme`, key: "theme", value: "ocean", updatedAt: new Date().toISOString() } });
    a.emit("SYNC_MUTATE", { companyId: businessId, entity: "image", action: "create", id: "img-2", payload: { id: "img-2", kind: "product", mime: "image/png", width: 10, height: 10, bytes: 100, data: tinyWebp(), updatedAt: new Date().toISOString() } });
    await wait(600);

    const c = await connect();
    const offered = collect(c, "STATE_OFFERED");
    const events = collect(c, "SYNC_EVENT");
    c.emit("REQUEST_STATE", { companyId: businessId, since: null });
    await wait(1000);

    const fromServer = offered.find((o) => o.fromSocketId === "server");
    assert.ok(fromServer, "server answered the bootstrap");
    assert.equal(fromServer.entities.images, undefined, "no images in the bulk message");
    assert.deepEqual(fromServer.entities.prefs.map((p) => p.value), ["ocean"], "preferences are in it");
    assert.deepEqual(events.filter((e) => e.entity === "image").map((e) => e.payload.id).sort(), ["img-1", "img-2"]);
  });

  test("deleting an image leaves no bytes on the server", async () => {
    const a = sockets[0];
    a.emit("SYNC_MUTATE", { companyId: businessId, entity: "image", action: "delete", id: "img-1", payload: { id: "img-1" } });
    await wait(600);
    const conn = await mongoose.createConnection(DB_URI).asPromise();
    const row = await conn.db.collection("entitysnapshots").findOne({ businessId, entity: "image", entityId: "img-1" });
    await conn.close();
    assert.equal(row.deleted, true);
    assert.equal(row.payload.data, undefined);
  });

  test("the profile endpoint saves profile fields and ignores billing and plan", async () => {
    const post = (body) =>
      fetch(`${BASE}/api/sync/business`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    const res = await post({
      id: businessId,
      businessName: "Sync Ltd (renamed)",
      brandColor: "#22307a",
      logoImageId: "img-2",
      billing: { status: "active", planTier: "company", seats: 50 },
      plan: { tier: "company", maxDevices: 99 },
    });
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    assert.equal(data.business.businessName, "Sync Ltd (renamed)");
    assert.equal(data.business.brandColor, "#22307a");
    assert.equal(data.business.logoImageId, "img-2");
    assert.equal(data.business.billing.status, "trialing", "billing untouched");
    assert.equal(data.business.plan.maxDevices, 1, "device limit untouched");

    assert.equal((await post({ id: businessId, brandColor: "red" })).status, 400);
    assert.equal((await post({ id: "someone-else", businessName: "x" })).status, 403);
  });

  test("a profile save nudges the business's devices to re-read it, and nothing else", async () => {
    const watcher = await connect();
    const nudges = collect(watcher, "BUSINESS_UPDATED");
    const res = await fetch(`${BASE}/api/sync/business`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: businessId, businessName: "Sync Ltd (again)" }),
    });
    assert.equal(res.status, 200);
    await wait(300);
    assert.equal(nudges.length, 1);
    assert.deepEqual(nudges[0], {}, "the nudge carries no profile or billing data");

    // A refused save announces nothing.
    await fetch(`${BASE}/api/sync/business`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: businessId, brandColor: "not-a-colour" }),
    });
    await wait(300);
    assert.equal(nudges.length, 1);
  });
});

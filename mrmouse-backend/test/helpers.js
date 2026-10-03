// test/helpers.js — shared set-up. Environment first: auth.js refuses to
// load without AUTH_SECRET.
const crypto = require("crypto");

process.env.AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString("hex");
process.env.HORDEMART_SSO_SECRET = "s".repeat(48);
process.env.HORDEMART_WEBHOOK_SECRET = "w".repeat(48);
process.env.HORDEMART_API_URL = "https://hordemart.test";

const http = require("http");
const express = require("express");
const mongoose = require("mongoose");

const MONGO_TEST_URI = process.env.MONGO_TEST_URI || "";
// Integration tests need a real MongoDB. Without one they are skipped, loudly.
const skipWithoutDb = MONGO_TEST_URI ? false : "MONGO_TEST_URI is not set — database tests skipped";

async function connectTestDb(name) {
  const base = MONGO_TEST_URI.replace(/\/[^/?]*(\?|$)/, `/mrmouse_test_${name}_${process.pid}$1`);
  await mongoose.connect(base, { serverSelectionTimeoutMS: 10_000 });
  await mongoose.connection.db.dropDatabase();
  // Unique indexes must exist before the tests that rely on them.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}

async function disconnectTestDb() {
  if (mongoose.connection.readyState === 1) await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
}

// A Socket.io stand-in that remembers what was broadcast.
function fakeIo() {
  const emitted = [];
  const room = (name) => ({
    emit: (event, payload) => emitted.push({ room: name, event, payload }),
    except: () => room(name),
  });
  return { emitted, to: room };
}

// The same mounting order as server.js.
function buildTestApp(io = fakeIo()) {
  const { requireAuth, requireSameOrigin } = require("../auth");
  const buildUsersRouter = require("../routes/users");
  const buildConsentsRouter = require("../routes/consents");
  const buildAiChatRouter = require("../routes/aiChat");
  const buildDevicesRouter = require("../routes/devices");
  const { buildHordeMartSsoRouter, buildHordeMartSalesRouter } = require("../routes/hordemart");

  const app = express();
  app.use("/integrations/hordemart/sales", buildHordeMartSalesRouter(io));
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/users", buildUsersRouter(io));
  app.use("/api/devices", requireAuth, requireSameOrigin, buildDevicesRouter(io));
  app.use("/api/ai", requireAuth, requireSameOrigin, buildAiChatRouter(io));
  app.use("/api/consents", requireAuth, requireSameOrigin, buildConsentsRouter());
  app.use("/api/integrations/hordemart", requireSameOrigin, buildHordeMartSsoRouter());
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    res.status(status).json({ error: status >= 500 ? "Internal server error" : err.message });
  });
  return { app, io };
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body, token, headers = {}, raw } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data, headers: res.headers };
  };
  return { base, call, close: () => new Promise((resolve) => server.close(resolve)) };
}

// A HordeMart sign-in pass, signed the way HordeMart's signHandoffToken does.
function signPass(overrides = {}, { secret = process.env.HORDEMART_SSO_SECRET, header = { alg: "HS256", typ: "JWT" } } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: "hordemart",
    aud: "mrmouse",
    sub: "hm-user-1",
    email: "ade@example.com",
    email_verified: true,
    name: "Ade Okon",
    role: "owner",
    site: { id: "site-1", slug: "ade-store", name: "Ade Textiles", url: "https://ade-store.hordemart.com" },
    iat: now,
    exp: now + 60,
    jti: crypto.randomBytes(16).toString("hex"),
    ...overrides,
  };
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const head = enc(header);
  const body = enc(claims);
  const sig = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return { token: `${head}.${body}.${sig}`, claims };
}

function resetLimits() {
  const { limits } = require("../lib/rateLimit");
  for (const limiter of Object.values(limits)) limiter.reset();
}

module.exports = {
  skipWithoutDb,
  connectTestDb,
  disconnectTestDb,
  fakeIo,
  buildTestApp,
  listen,
  signPass,
  resetLimits,
};

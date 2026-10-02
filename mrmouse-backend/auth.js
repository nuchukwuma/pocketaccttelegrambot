// auth.js — signed, HttpOnly cookie authentication.
const crypto = require("crypto");
const User = require("./models/User");

const COOKIE_NAME = "ledger_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const SECRET = process.env.AUTH_SECRET;

const ALLOWED_ORIGINS = [
  process.env.CLIENT_ORIGIN || "http://localhost:5173",
  "https://localhost",       // Capacitor Android WebView origin
  "capacitor://localhost",   // Capacitor iOS WebView origin
  "file://",                 // Electron
];

if (!SECRET || SECRET.length < 32) {
  throw new Error("AUTH_SECRET must be set to a random value of at least 32 characters");
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}
function sign(input) {
  return crypto.createHmac("sha256", SECRET).update(input).digest("base64url");
}
function createToken(user) {
  const payload = {
    sub: user.id,
    businessId: user.businessId,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}
function getBearerToken(req) {
  const authorization = req.headers.authorization || "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim();
  return null;
}

function getTokenFromRequest(req) {
  return getBearerToken(req) || parseCookies(req.headers.cookie)[COOKIE_NAME];
}

function verifyToken(token) {
  if (!token) return null;
  const [body, signature] = String(token).split(".");
  if (!body || !signature) return null;
  const expected = sign(body);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  if (!payload?.sub || !payload?.businessId || !payload?.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

async function requireAuth(req, res, next) {
  try {
    const token = getTokenFromRequest(req);
    const claims = verifyToken(token);
    if (!claims) return res.status(401).json({ error: "Authentication required" });

    // Load the user on every request so role/business changes take effect immediately.
    const user = await User.findOne({ id: claims.sub }).lean();
    if (!user || user.businessId !== claims.businessId) {
      return res.status(401).json({ error: "Session is no longer valid" });
    }
    req.user = user;
    req.auth = claims;
    next();
  } catch (err) { next(err); }
}

async function requireBotAuth(req, res, next) {
  try {
    const key = req.headers["x-bot-api-key"];
    if (!key || !process.env.BOT_API_KEY || key !== process.env.BOT_API_KEY) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const requestedBusinessId =
      req.query?.companyId ||
      req.query?.businessId ||
      req.body?.businessId ||
      req.params?.businessId;

    if (!requestedBusinessId) {
      return res.status(400).json({ error: "businessId is required" });
    }

    const user = await User.findOne({
      businessId: requestedBusinessId,
      role: "owner",
    }).lean();

    if (!user) return res.status(404).json({ error: "Business owner not found" });

    req.user = user;
    req.auth = { sub: user.id, businessId: user.businessId, role: user.role, bot: true };
    next();
  } catch (err) {
    next(err);
  }
}

async function requireAuthOrBot(req, res, next) {
  const botKey = req.headers["x-bot-api-key"];
  if (botKey) return requireBotAuth(req, res, next);
  return requireAuth(req, res, next);
}

function requireBusinessAccess(source = "query") {
  return (req, res, next) => {
    const requested = source === "params"
      ? req.params.businessId
      : source === "body"
      ? req.body?.businessId
      : req.query?.businessId;

    if (!requested) return res.status(400).json({ error: "businessId is required" });
    if (requested !== req.user.businessId) {
      return res.status(403).json({ error: "You are not a member of this business" });
    }
    next();
  };
}

function requireOwnerOrAdmin(req, res, next) {
  if (!["owner", "admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Owner or admin access required" });
  }
  next();
}

function setSessionCookie(res, user) {
  const secure = process.env.NODE_ENV === "production";
  const sameSite = process.env.COOKIE_SAMESITE || "None";
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(createToken(user))}`,
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "HttpOnly",
    `SameSite=${sameSite}`,
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  const sameSite = process.env.COOKIE_SAMESITE || "Lax";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=${sameSite}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
}

function requireSameOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: "Invalid request origin" });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  requireAuth,
  requireBusinessAccess,
  requireOwnerOrAdmin,
  requireSameOrigin,
  setSessionCookie,
  clearSessionCookie,
  verifyToken,
  createToken,
  requireBotAuth,
  requireAuthOrBot,
};

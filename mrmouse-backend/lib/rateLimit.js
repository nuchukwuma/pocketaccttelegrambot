// lib/rateLimit.js
//
// Fixed-window limits for sign-in, sign-up and payment routes. Kept in this
// process's memory: right for one server. Running several instances behind
// a load balancer multiplies the allowance by the instance count — move the
// counters to Redis (or similar) before scaling out.
//
// Counts by client IP, so behind a proxy (Render, Railway, Nginx…) set
// TRUST_PROXY (see server.js) or every visitor shares the proxy's address.

function createRateLimiter({ name, limit, windowMs, key = (req) => req.ip, message, now = () => Date.now() }) {
  const hits = new Map(); // key -> { count, resetAt }

  // Forget finished windows now and then so the map cannot grow forever.
  const sweep = setInterval(() => {
    const t = now();
    for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
  }, Math.max(windowMs, 60_000));
  sweep.unref?.();

  function middleware(req, res, next) {
    const id = `${name}:${String(key(req) || "unknown").toLowerCase()}`;
    const t = now();
    let entry = hits.get(id);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(id, entry);
    }
    entry.count += 1;
    if (entry.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - t) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: message || "Too many attempts. Wait a few minutes and try again.",
        code: "RATE_LIMITED",
      });
    }
    next();
  }

  middleware.reset = () => hits.clear();
  return middleware;
}

const MINUTE = 60_000;

// One set per process, shared by the routes that use them.
const limits = {
  // Per IP and per email, so one address cannot be hammered from many IPs
  // and one IP cannot try many addresses.
  loginByIp: createRateLimiter({ name: "login-ip", limit: 20, windowMs: 15 * MINUTE }),
  loginByEmail: createRateLimiter({
    name: "login-email",
    limit: 10,
    windowMs: 15 * MINUTE,
    key: (req) => (typeof req.body?.email === "string" ? req.body.email.trim() : req.ip),
  }),
  signup: createRateLimiter({ name: "signup", limit: 10, windowMs: 60 * MINUTE }),
  hordemartSso: createRateLimiter({ name: "hordemart-sso", limit: 30, windowMs: 15 * MINUTE }),
  payment: createRateLimiter({ name: "payment", limit: 20, windowMs: 15 * MINUTE }),
};

module.exports = { createRateLimiter, limits };

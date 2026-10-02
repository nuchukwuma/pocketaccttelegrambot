const AiUsage = require("../models/AiUsage");

const DEFAULT_DAILY_LIMIT = 20;

function getDailyLimit() {
  const parsed = Number(process.env.GEMINI_FREE_DAILY_REQUESTS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_DAILY_LIMIT;
}

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

async function getUsage(companyId, now = new Date()) {
  const limit = getDailyLimit();
  const row = await AiUsage.findOne({ businessId: companyId, day: dayKey(now) }).lean();
  const used = Number(row?.requests || 0);
  return { used, limit, remaining: Math.max(0, limit - used), day: dayKey(now) };
}

async function consumeFreeRequest(companyId, now = new Date()) {
  const limit = getDailyLimit();
  const day = dayKey(now);

  // Create the counter on first use.
  try {
    await AiUsage.create({ businessId: companyId, day, requests: 0 });
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }

  const updated = await AiUsage.findOneAndUpdate(
    { businessId: companyId, day, requests: { $lt: limit } },
    { $inc: { requests: 1 }, $set: { updatedAt: now } },
    { new: true }
  ).lean();

  if (!updated) {
    return { ok: false, used: limit, limit, remaining: 0, day };
  }

  const used = Number(updated.requests || 0);
  return { ok: true, used, limit, remaining: Math.max(0, limit - used), day };
}

function freeLimitMessage(limit) {
  return `You've reached the free Gemini AI limit for today (${limit} requests for this business). Your records are safe. You can try again tomorrow or upgrade to Premium AI (Claude) for higher availability and larger workloads.`;
}

module.exports = { getDailyLimit, getUsage, consumeFreeRequest, freeLimitMessage };

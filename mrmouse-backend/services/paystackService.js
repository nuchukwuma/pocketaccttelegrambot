// services/paystackService.js
const https = require("https");

const PAYSTACK_URL = "https://api.paystack.co";

function secretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured");
  }
  return key;
}

function requestJson(path, method, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);

    const req = https.request(
      `${PAYSTACK_URL}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${secretKey()}`,
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let data;
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch {
            return reject(new Error(`Paystack returned invalid JSON (${res.statusCode})`));
          }

          if (res.statusCode < 200 || res.statusCode >= 300 || data.status === false) {
            return reject(
              new Error(data.message || `Paystack request failed (${res.statusCode})`)
            );
          }

          resolve(data);
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(30_000, () => {
      req.destroy(new Error("Paystack request timed out"));
    });

    if (payload) req.write(payload);
    req.end();
  });
}

async function initializeTransaction({
  email,
  amountNaira,
  reference,
  planCode,
  callbackUrl,
  metadata,
}) {
  const body = {
    email,
    amount: String(Math.round(Number(amountNaira) * 100)),
    currency: "NGN",
    reference,
    ...(planCode ? { plan: planCode } : {}),
    ...(callbackUrl ? { callback_url: callbackUrl } : {}),
    ...(metadata ? { metadata: JSON.stringify(metadata) } : {}),
  };

  const response = await requestJson("/transaction/initialize", "POST", body);
  return response.data;
}

async function verifyTransaction(reference) {
  const response = await requestJson(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    "GET"
  );
  return response.data;
}

async function fetchSubscription(subscriptionCode) {
  const response = await requestJson(
    `/subscription/${encodeURIComponent(subscriptionCode)}`,
    "GET"
  );
  return response.data;
}

async function createSubscription({ customer, plan, authorization, startDate }) {
  const response = await requestJson("/subscription", "POST", {
    customer,
    plan,
    ...(authorization ? { authorization } : {}),
    ...(startDate ? { start_date: startDate } : {}),
  });
  return response.data;
}

module.exports = {
  initializeTransaction,
  verifyTransaction,
  fetchSubscription,
  createSubscription,
};

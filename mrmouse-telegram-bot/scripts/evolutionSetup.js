import fs from "fs/promises";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

import {
  getEvolutionInstance,
  saveEvolutionInstance,
} from "../db.js";

const API_URL = (
  process.env.EVOLUTION_API_URL || "http://localhost:8080"
).replace(/\/+$/, "");

const API_KEY = process.env.EVOLUTION_API_KEY || "";

const companyId = process.argv[2];

if (!API_KEY) {
  throw new Error("EVOLUTION_API_KEY is missing.");
}

if (!companyId) {
  throw new Error(
    "Usage: node scripts/evolutionSetup.js <companyId>"
  );
}

function safePart(value) {
  return (
    String(value)
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 36) || "business"
  );
}

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      apikey: API_KEY,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      `Evolution ${response.status}: ${
        data?.response?.message?.[0] ||
        data?.message ||
        data?.error ||
        data?.raw ||
        response.statusText
      }`
    );
  }

  return data;
}

function extractQr(data) {
  const qr =
    data?.qrcode?.base64 ||
    data?.qrcode?.image ||
    data?.base64 ||
    data?.image ||
    null;

  if (!qr) return null;

  return qr.startsWith("data:image")
    ? qr
    : `data:image/png;base64,${qr}`;
}

let account = await getEvolutionInstance(companyId);

if (!account) {
  const instanceName = `mrmouse_${safePart(companyId)}_${crypto
    .randomBytes(4)
    .toString("hex")}`;

  const created = await request("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
    }),
  });

  account = await saveEvolutionInstance(
    companyId,
    instanceName,
    created?.hash?.apikey ||
      created?.apikey ||
      created?.token ||
      null,
    "created"
  );
}

const qrData = await request(
  `/instance/connect/${encodeURIComponent(account.instance_name)}`
);

const qr = extractQr(qrData);

const html = qr
  ? `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>PocketAccountant WhatsApp QR</title>
<style>
body { font-family: system-ui, sans-serif; display:grid; place-items:center; min-height:100vh; margin:0; }
main { text-align:center; }
img { width:360px; max-width:90vw; border:1px solid #ddd; padding:12px; border-radius:12px; }
p { color:#555; }
</style>
</head>
<body>
<main>
<h1>Connect WhatsApp</h1>
<p>Use the WhatsApp account belonging to this PocketAccountant business.</p>
<p><strong>WhatsApp → Linked Devices → Link a device → Scan</strong></p>
<img src="${qr}" alt="WhatsApp QR code">
</main>
</body>
</html>`
  : `<!doctype html>
<html><body><pre>${escapeHtml(JSON.stringify(qrData, null, 2))}</pre></body></html>`;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

await fs.writeFile(`evolution-qr-${safePart(companyId)}.html`, html, "utf8");

console.log(`Company: ${companyId}`);
console.log(`Evolution instance: ${account.instance_name}`);
console.log(`QR file: evolution-qr-${safePart(companyId)}.html`);

// WhatsApp invoice PDFs carry the business's logo and brand colour, and a
// bad brand never breaks the send: it is dropped and a plain invoice goes.
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { buildInvoicePdf, cleanBrand } from "../src/whatsappPdf.js";

// A real 1x1 PNG.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
const invoice = {
  invoiceNumber: "INV-7",
  date: "2026-10-03",
  party: "Adaeze Foods",
  items: [{ description: "Rice 50kg", quantity: 2, unitPrice: 48000, netAmount: 96000 }],
  subtotal: 96000,
  total: 96000,
};
const business = { businessName: "Compare Foods", location: "Balogun Market, Lagos" };

test("cleanBrand keeps a hex colour and a real JPEG or PNG, and drops anything else", () => {
  const good = cleanBrand({ color: "#22307a", logo: { mime: "image/png", data: PNG_1PX.toString("base64") } });
  assert.equal(good.color, "#22307a");
  assert.ok(Buffer.isBuffer(good.logo));

  assert.deepEqual(cleanBrand(undefined), { color: null, logo: null });
  assert.equal(cleanBrand({ color: "red" }).color, null);
  assert.equal(cleanBrand({ color: "#22307a; fill: url(x)" }).color, null);
  // Not an image (an SVG, say) is dropped even when it is labelled as one.
  const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64");
  assert.equal(cleanBrand({ logo: { mime: "image/png", data: svg } }).logo, null);
  // Oversized: dropped.
  const huge = Buffer.concat([PNG_1PX, Buffer.alloc(70 * 1024)]).toString("base64");
  assert.equal(cleanBrand({ logo: { data: huge } }).logo, null);
  assert.equal(cleanBrand({ logo: { data: "not base64!!" } }).logo, null);
});

test("the invoice PDF draws the logo and the brand colour", async () => {
  const pdf = await buildInvoicePdf(business, invoice, {
    color: "#22307a",
    logo: { mime: "image/png", data: PNG_1PX.toString("base64") },
  });
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF"));
  assert.match(text, /\/Subtype \/Image/, "logo embedded");
  // pdfkit writes fill colours as 0–1 RGB ("r g b scn") in the compressed content stream.
  const streams = [...text.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((m) => {
    const raw = Buffer.from(m[1], "latin1");
    try {
      return zlib.inflateSync(raw).toString("latin1");
    } catch {
      return raw.toString("latin1");
    }
  });
  const brandRgb = [0x22, 0x30, 0x7a].map((v) => String(v / 255)).join(" ");
  assert.ok(streams.some((s) => s.includes(`${brandRgb} scn`)), `brand fill ${brandRgb}`);
});

test("a broken brand still produces a plain invoice", async () => {
  const pdf = await buildInvoicePdf(business, invoice, { color: "nope", logo: { data: "@@@" } });
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF"));
  assert.doesNotMatch(text, /\/Subtype \/Image/);
});

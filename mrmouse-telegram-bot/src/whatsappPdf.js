// Deliberately simple, single-page-friendly PDFs — these are for sending
// a quick document over WhatsApp, not replacing a full print-quality
// invoice design. pdfkit streams; we collect it into a Buffer since
// that's what the WhatsApp media upload call needs.
import PDFDocument from "pdfkit";
import { money, computeStock } from "./ledger.js";

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function header(doc, business, title) {
  doc.fontSize(18).text(business?.businessName || business?.name || "Business", { continued: false });
  doc.fontSize(10).fillColor("#666").text(business?.location || business?.address || "");
  doc.moveDown(1);
  doc.fontSize(14).fillColor("#000").text(title);
  doc.fontSize(9).fillColor("#666").text(new Date().toLocaleDateString());
  doc.moveDown(1);
  doc.fillColor("#000");
}

export async function buildInvoicePdf(business, invoice) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  header(doc, business, `Invoice ${invoice.invoiceNumber || ""}`);

  doc.fontSize(10);
  doc.text(`Billed to: ${invoice.party || "—"}`);
  if (invoice.partyContact) doc.text(invoice.partyContact);
  doc.text(`Date: ${invoice.date || ""}`);
  if (invoice.dueDate) doc.text(`Due: ${invoice.dueDate}`);
  doc.moveDown(1);

  const items = invoice.items || [];
  const colX = { desc: 50, qty: 300, price: 360, amount: 450 };
  doc.fontSize(9).fillColor("#666");
  doc.text("Description", colX.desc, doc.y);
  doc.text("Qty", colX.qty, doc.y, { width: 50 });
  doc.text("Price", colX.price, doc.y, { width: 80 });
  doc.text("Amount", colX.amount, doc.y, { width: 90 });
  doc.moveDown(0.5);
  doc.strokeColor("#ccc").moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.5);
  doc.fillColor("#000");

  items.forEach((item) => {
    const rowY = doc.y;
    const amount = item.netAmount ?? Number(item.quantity) * Number(item.unitPrice);
    doc.fontSize(10);
    doc.text(item.description || "—", colX.desc, rowY, { width: 240 });
    doc.text(String(item.quantity ?? ""), colX.qty, rowY, { width: 50 });
    doc.text(money(item.unitPrice), colX.price, rowY, { width: 80 });
    doc.text(money(amount), colX.amount, rowY, { width: 90 });
    doc.moveDown(0.7);
  });

  doc.moveDown(0.5);
  doc.strokeColor("#ccc").moveTo(300, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.5);

  const totalsLine = (label, value, bold) => {
    doc.fontSize(bold ? 12 : 10).font(bold ? "Helvetica-Bold" : "Helvetica");
    doc.text(label, 350, doc.y, { width: 100 });
    doc.text(money(value), 450, doc.y, { width: 90 });
    doc.moveDown(0.4);
  };
  if (invoice.subtotal != null) totalsLine("Subtotal", invoice.subtotal);
  if (invoice.discountAmount) totalsLine("Discount", -invoice.discountAmount);
  if (invoice.taxAmount) totalsLine("Tax", invoice.taxAmount);
  totalsLine("Total", invoice.total ?? invoice.subtotal ?? 0, true);

  if (invoice.notes) {
    doc.moveDown(1.5);
    doc.fontSize(9).font("Helvetica").fillColor("#666").text(invoice.notes);
  }

  return toBuffer(doc);
}

export async function buildBalanceReportPdf(business, { cash, bank, pettyCash, debtors, creditors, netProfit }) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  header(doc, business, "Balance Summary");

  doc.fontSize(11);
  [
    ["Cash", cash],
    ["Bank", bank],
    ["Petty cash", pettyCash],
    ["Net profit", netProfit],
  ].forEach(([label, value]) => {
    doc.text(`${label}: ${money(value)}`);
    doc.moveDown(0.3);
  });

  if (debtors?.length) {
    doc.moveDown(1);
    doc.fontSize(12).text("Debtors (owed to you)");
    doc.fontSize(10);
    debtors.forEach((d) => doc.text(`  ${d.name}: ${money(d.balance)}`));
  }

  if (creditors?.length) {
    doc.moveDown(1);
    doc.fontSize(12).text("Creditors (you owe)");
    doc.fontSize(10);
    creditors.forEach((c) => doc.text(`  ${c.name}: ${money(c.balance)}`));
  }

  return toBuffer(doc);
}

export async function buildInventoryReportPdf(business, products) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  header(doc, business, "Inventory Report");

  doc.fontSize(9).fillColor("#666");
  doc.text("Product", 50, doc.y, { width: 300 });
  doc.text("In stock", 400, doc.y, { width: 100 });
  doc.moveDown(0.5);
  doc.strokeColor("#ccc").moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.5);
  doc.fillColor("#000").fontSize(10);

  products.forEach((p) => {
    const rowY = doc.y;
    doc.text(p.name, 50, rowY, { width: 300 });
    doc.text(String(computeStock(p)), 400, rowY, { width: 100 });
    doc.moveDown(0.5);
  });

  return toBuffer(doc);
}

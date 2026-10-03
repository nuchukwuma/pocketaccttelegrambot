/* The twelve accounting words Mr Mouse uses, in plain language, each
   with an everyday Nigerian example. Shown on Settings → Help →
   Accounting basics (they used to be the Quick Learning pop-up). */

export const GLOSSARY = [
  {
    term: "Cash Book",
    tip: "Every naira that moves through actual cash or your bank account, recorded in one place — it's your record of real money in and out.",
    example: "You sell ₦12,000 of drinks for cash and pay ₦4,000 by transfer for ice. Both lines go in the Cash Book: one in the cash column, one in the bank column.",
  },
  {
    term: "Petty Cash",
    tip: "The small, everyday spends — transport, snacks, odd errands — kept in their own pool so they don't get lost among the bigger numbers.",
    example: "Keep ₦10,000 aside for small things. A ₦1,500 keke ride to the market and ₦500 for pure water come out of it.",
  },
  {
    term: "Debtors",
    tip: "People or businesses that owe you money — usually because you sold to them on credit and haven't been paid yet.",
    example: "Mr Okafor took 3 cartons of noodles worth ₦27,000 and said he'll pay on Friday. Until he pays, he is your debtor.",
  },
  {
    term: "Creditors",
    tip: "Suppliers you owe money to — you bought goods or services from them on credit and payment is still outstanding.",
    example: "Your supplier gave you 10 bags of sugar worth ₦650,000 to pay at month end. Until you pay, they are your creditor.",
  },
  {
    term: "Sales / Purchases Journal",
    tip: "A running list of everything sold or bought on credit — it's where you track money that's owed rather than already settled.",
    example: "A ₦45,000 sale to a school on credit goes in the Sales Journal; ₦80,000 of fabric you bought on credit goes in the Purchases Journal.",
  },
  {
    term: "Ledger",
    tip: "Every account gets its own running story here — Cash, Sales, each customer's balance — pulled together from all your entries.",
    example: "Open Mrs Bello's account to see she bought ₦60,000, paid ₦40,000, and still owes ₦20,000.",
  },
  {
    term: "Trial Balance",
    tip: "A health check on your books: total debits should always equal total credits. If they don't, something was recorded wrong somewhere.",
    example: "If debits add up to ₦1,250,000 and credits to ₦1,245,000, a ₦5,000 entry was recorded on one side only. Find it before you trust the totals.",
  },
  {
    term: "Gross Profit vs Net Profit",
    tip: "Gross profit is sales minus the cost of the goods you sold. Net profit is what's left after every other expense is taken out too.",
    example: "Sales ₦500,000, goods cost ₦320,000: gross profit ₦180,000. Take away ₦60,000 rent and ₦30,000 transport: net profit ₦90,000.",
  },
  {
    term: "VAT Payable",
    tip: "VAT you collect from customers isn't your money to keep — it's the government's. This tracks how much you currently owe them.",
    example: "On a ₦100,000 sale with 7.5% VAT the customer pays ₦107,500. The ₦7,500 belongs to the tax office, not to your profit. Ask a tax adviser whether your business must charge VAT.",
  },
  {
    term: "Assets vs Liabilities",
    tip: "Assets are things the business owns or is owed — cash, stock, debtors. Liabilities are what the business owes to others.",
    example: "₦200,000 in the bank, ₦350,000 of stock and ₦50,000 owed by customers are assets. A ₦150,000 supplier balance and a ₦300,000 loan are liabilities.",
  },
  {
    term: "Double-Entry Bookkeeping",
    tip: "Every transaction touches two accounts, not one — money doesn't just appear, it always moves from somewhere to somewhere.",
    example: "Buy a ₦25,000 generator part with cash: Cash goes down ₦25,000 and Equipment goes up ₦25,000. Mr Mouse writes both sides for you.",
  },
  {
    term: "Invoice",
    tip: "A formal bill for goods or services sold — it turns a sale into a paper trail both you and your customer can refer back to.",
    example: "Send a customer an invoice for ₦150,000 of ankara with the date and items listed, and there is no argument later about what was agreed.",
  },
];

/** Entries whose term, explanation or example mention every word typed. */
export function searchGlossary(query) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return GLOSSARY;
  return GLOSSARY.filter((g) => {
    const text = `${g.term} ${g.tip} ${g.example}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

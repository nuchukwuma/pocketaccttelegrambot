/* ---------------------------------------------------------------
   The guided tour, step by step.

   Each step opens a screen (`page` + `params`, the same arguments the
   app's own navigation takes), highlights one element on it
   (`target` = its data-tour attribute) and explains it twice: how to
   use it, and why it matters to a small business. Plain words, real
   Naira amounts, no accounting jargon without an explanation.

   Changing the steps is safe for people part-way through: progress is
   stored as a step id, and an id that no longer exists restarts the
   tour from the top.
--------------------------------------------------------------- */

export const TOUR_STEPS = [
  {
    id: "welcome",
    page: "dashboard",
    target: "dashboard-hero",
    title: "Your money at a glance",
    how: "This big number is the cash in your till plus the money in your bank account. Check it every morning before you spend.",
    why: "Sales are not the same as money. If Mama Nkechi's shop sold ₦85,000 this week but customers still owe ₦55,000 of it, only ₦30,000 can pay the supplier today. This number tells you what you can really spend.",
  },
  {
    id: "actions",
    page: "dashboard",
    target: "dashboard-actions",
    title: "Start here",
    how: "Tap a card to do a job: write an invoice, record a sale or an expense, or open your books. The red number on Reminders counts people who owe you or are owed by you.",
    why: "Everything you do most often is one tap from Home, so recording a ₦2,500 transport fare takes seconds — and small spends stop going missing.",
  },
  {
    id: "addentry",
    page: "addentry",
    target: "addentry-form",
    title: "Add entry: write down what happened",
    how: "Choose what happened (a sale, a purchase or an expense), type the amount, and say how it was paid: cash, transfer, or on credit. Then press Save entry.",
    why: "One entry fills every book for you. Sell 2 bags of rice for ₦96,000 by transfer and Mr Mouse puts it in your Cash Book, your sales and your stock count at once. No copying the same figure into three notebooks.",
  },
  {
    id: "cashbook",
    page: "book-page",
    params: { book: "cashbook" },
    target: "book-page",
    title: "Cash Book: every naira in and out",
    how: "Every cash and bank movement, in date order, with a running balance. Count your drawer and compare it with the cash column.",
    why: "If the book says ₦42,500 and the drawer holds ₦40,000, you know today that ₦2,500 is missing — not at the end of the month when nobody remembers why.",
  },
  {
    id: "inventory",
    page: "book-page",
    params: { book: "inventory" },
    target: "inventory",
    title: "Inventory: know what's on the shelf",
    how: "Add each product once. After that, sales take stock away and purchases add it back on their own. Products with 5 or fewer left are flagged.",
    why: "You will see you have only 3 cartons of Indomie left before a customer asks for 5 — so you restock in time instead of sending money away.",
  },
  {
    id: "invoice",
    page: "invoice",
    target: "invoice-form",
    title: "Invoice Builder: get paid faster",
    how: "Type your customer's name and the items with their prices. Send it on WhatsApp, share it, or print it. Your logo and brand colour go on it automatically.",
    why: "A customer who gets a proper invoice for ₦150,000 of ankara fabric pays sooner, and you both have a record if there is ever a dispute.",
  },
  {
    id: "reports",
    page: "book-page",
    params: { book: "pnlstatement" },
    target: "book-page",
    title: "Reports: did you actually make a profit?",
    how: "The Statement shows profit and loss: what you sold, minus what the goods cost you, minus your running costs. The trial balance below it checks your books add up.",
    why: "You sold ₦500,000 this month, but after ₦320,000 of stock and ₦90,000 for rent and transport, you made ₦90,000. That last number is the one that tells you if the business is working.",
  },
  {
    id: "finish",
    page: "dashboard",
    target: "nav-settings",
    title: "You're ready",
    how: "Take this tour again any time from Settings → Help. Accounting basics, in the same place, explains words like Debtors, Creditors and VAT.",
    why: "A few minutes a day keeps your books ready for a loan application, a tax question or a partner who asks how the business is doing.",
  },
];

export const TOUR_PREF = "tour";

/** Index of a stored step id, or 0 when it is unknown (steps changed). */
export function stepIndex(id) {
  const i = TOUR_STEPS.findIndex((s) => s.id === id);
  return i < 0 ? 0 : i;
}

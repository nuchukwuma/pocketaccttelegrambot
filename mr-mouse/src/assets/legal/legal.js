/* ---------------------------------------------------------------
   Everything Mr Mouse asks people to agree to, in one place.

   ⚠️  DRAFTS. Written from how the app works; not yet reviewed by a
   Nigerian lawyer (NDPA 2023, FCCPA). LEGAL_DRAFT shows a notice on
   every document until that review is done.

   Each consent has a VERSION. Bump it (to the date of the change)
   whenever its text changes in substance: everyone is asked again,
   and the new version is what gets recorded.
--------------------------------------------------------------- */

export const LEGAL_DRAFT = true;

export const LEGAL_CONTACT = "privacy@mrmouse.ng"; // TODO: confirm address

export const CONSENTS = {
  terms: {
    version: "2026-10-02",
    title: "Terms of Service and Privacy Policy",
  },
  ai: {
    version: "2026-10-02",
    title: "Mr Mouse assistant (AI)",
    summary: "Answers questions about your books using an AI service.",
    points: [
      "Your question, and the figures needed to answer it — balances, stock, who owes you and who you owe, pending orders — are sent to an AI provider: Google (Gemini) on the Free plan, Anthropic (Claude) on Premium.",
      "These providers process it outside Nigeria, under their own terms for business customers.",
      "Don't type customers' personal details (phone numbers, addresses, ID numbers) into the assistant.",
      "AI answers can be wrong. Check figures against your books before acting on them.",
    ],
  },
  telegram: {
    version: "2026-10-02",
    title: "Connect Telegram",
    summary: "Sends your summaries and reminders to your own Telegram.",
    points: [
      "Mr Mouse will send your business summaries, balances and reminders to the Telegram account you link.",
      "Those messages pass through Telegram, which processes them outside Nigeria under its own privacy policy.",
      "If your plan includes the AI assistant, questions you type to the bot are answered by the AI provider described under \"Mr Mouse assistant (AI)\" — the same rules apply.",
      "Anyone with access to that Telegram account can read them. You can unlink at any time.",
    ],
  },
  whatsapp: {
    version: "2026-10-02",
    title: "Connect WhatsApp",
    summary: "Sends reminders and statements to your clients over WhatsApp.",
    points: [
      "Mr Mouse will use your linked WhatsApp number to send reminders and statements to the clients you add.",
      "Messages pass through WhatsApp (Meta), which processes them outside Nigeria under its own privacy policy.",
      "Only add clients who have agreed to receive WhatsApp messages from your business — that consent is yours to get and keep.",
      "You can unlink at any time.",
    ],
  },
  hordemart: {
    version: "2026-10-02",
    title: "Link your HordeMart store",
    summary: "Signs you in from your HordeMart dashboard, and can keep stock in step.",
    points: [
      "HordeMart tells Mr Mouse your name, email, your role (owner or staff) and your store's name and address, so we can sign you in to your Mr Mouse account and link it to that store.",
      "If the store owner switches on stock sync in HordeMart, Mr Mouse sends your products' stock levels (by item code) to HordeMart, and HordeMart tells Mr Mouse which items sold — never your customers' details or what they paid.",
      "Your Mr Mouse subscription stays separate from HordeMart: linking does not change your plan or what you pay.",
      "You can unlink at any time in Settings → Privacy.",
    ],
  },
};

export function currentVersion(purpose) {
  return CONSENTS[purpose]?.version ?? null;
}

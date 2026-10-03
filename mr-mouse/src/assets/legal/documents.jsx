import React from "react";
import { LEGAL_CONTACT, LEGAL_DRAFT, CONSENTS } from "./legal";

/* ---------------------------------------------------------------
   Mr Mouse Terms of Service and Privacy Policy (drafts).
   Rendered in a modal from the signup form, the terms-update screen
   and Settings → Privacy.
--------------------------------------------------------------- */

function DraftNotice() {
  if (!LEGAL_DRAFT) return null;
  return (
    <p className="rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-caption text-amber-deep mb-4">
      <strong>Draft.</strong> This describes how Mr Mouse works today and is being reviewed by our lawyers. It may change
      before it is final.
    </p>
  );
}

const H = ({ children }) => <h4 className="font-display text-sm font-semibold text-ink mt-5 mb-1.5">{children}</h4>;
const P = ({ children }) => <p className="font-body text-label leading-relaxed text-ink-soft mb-2">{children}</p>;
const L = ({ items }) => (
  <ul className="list-disc pl-5 font-body text-label leading-relaxed text-ink-soft space-y-1 mb-2">
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
);

export function TermsOfService() {
  return (
    <div>
      <DraftNotice />
      <P>Version {CONSENTS.terms.version}. These terms are the agreement between Mr Mouse and the business that uses it.</P>
      <H>1. What Mr Mouse is</H>
      <P>
        Software to keep your business's books: cash book, journals, ledgers, stock, invoices, reminders and reports. It
        organises the figures you enter; it is not an accountant, auditor or tax adviser, and its reports are only as
        accurate as what is entered.
      </P>
      <H>2. Your account</H>
      <L
        items={[
          "Give true details about yourself and your business.",
          "Keep your password private. You are responsible for what happens under your account and for the people you invite to it.",
          "The business owner decides who has access and can remove them.",
        ]}
      />
      <H>3. Plans and payment</H>
      <P>
        Paid plans are billed through Paystack and renew until cancelled. Cancelling stops the next renewal. If a payment
        fails, access may be limited until it is settled; your records are kept.
      </P>
      <H>4. Your data</H>
      <P>
        Your books belong to your business. We store them to run the service and do not sell them. You can export them and
        ask us to delete your account. See the Privacy Policy.
      </P>
      <H>5. Optional features</H>
      <P>
        The assistant (AI), Telegram, WhatsApp and the HordeMart link each send some of your data to another service. Each
        asks for your agreement before it is switched on, and can be switched off in Settings.
      </P>
      <H>6. Acceptable use</H>
      <P>Don't use Mr Mouse for anything illegal in Nigeria, to message people who have not agreed to hear from you, or to try to reach other businesses' data.</P>
      <H>7. Responsibility</H>
      <P>
        We work to keep Mr Mouse available and your data safe, but cannot promise it will never be unavailable. Nothing here
        takes away rights you have under Nigerian law. These terms are governed by the laws of the Federal Republic of
        Nigeria. We will tell you before material changes take effect.
      </P>
    </div>
  );
}

export function PrivacyPolicy() {
  return (
    <div>
      <DraftNotice />
      <P>Version {CONSENTS.terms.version}. How Mr Mouse handles personal data, under the Nigeria Data Protection Act 2023.</P>
      <H>What we collect</H>
      <L
        items={[
          "Account: your name, email, a scrambled (hashed) password, and the devices you sign in from.",
          "Business: name, CAC number, location, contact number, industry.",
          "Your books: transactions, products and stock, invoices, debtors and creditors — including the names and phone numbers of customers and suppliers you record.",
          "Billing: your plan and payment status (card details are handled by Paystack, never stored by us).",
        ]}
      />
      <H>Why</H>
      <P>To run the service you signed up for, keep it secure, bill for it, and meet our legal obligations.</P>
      <H>Who we share it with</H>
      <L
        items={[
          "Paystack — payments.",
          "Our hosting and database providers — to run the service.",
          "Only if you switch them on: Google or Anthropic (assistant), Telegram, WhatsApp (Meta), HordeMart. Each is described when you switch it on.",
          "Authorities, when the law requires it.",
        ]}
      />
      <P>Some of these process data outside Nigeria; we rely on the safeguards the NDPA requires. We do not sell personal data.</P>
      <H>Customers and suppliers you record</H>
      <P>
        You are responsible for having a lawful reason to record and contact them, and for telling them how you use their
        details.
      </P>
      <H>Your rights</H>
      <P>
        You can ask to see, correct, export or delete your data, withdraw consent for optional features at any time
        (Settings → Privacy), and complain to the Nigeria Data Protection Commission. Contact: {LEGAL_CONTACT}.
      </P>
    </div>
  );
}

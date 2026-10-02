// validation/schemas.js — request bodies, checked before any route uses them.
const { z } = require("zod");
const { CONSENT_VERSIONS, PURPOSES } = require("../legal/versions");

const PASSWORD_MIN = 12;

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);
const password = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters for your password`)
  .max(200, "That password is too long");
const shortText = (max) => z.string().trim().max(max);

const signupSchema = z.object({
  email,
  name: shortText(120).min(1, "Enter your name"),
  password,
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: "Tick the box to accept the Terms of Service and Privacy Policy" }),
  }),
  termsVersion: z.literal(CONSENT_VERSIONS.terms, {
    errorMap: () => ({ message: "The Terms have changed. Reload the page and accept the latest version." }),
  }),
  business: z.object({
    businessName: shortText(200).min(1, "Enter your business name"),
    cac: shortText(60).optional(),
    location: shortText(300).optional(),
    contact: shortText(120).optional(),
    industry: shortText(120).optional(),
    email: z.union([email, z.literal("")]).optional(),
  }),
});

// No minimum here: people who signed up under the old 6-character rule
// must still be able to sign in.
const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password").max(200),
});

const inviteSchema = z.object({
  email,
  name: shortText(120).min(1, "Enter a name"),
  password,
  businessId: z.string().min(1),
  role: z.enum(["admin", "staff", "accountant"]).optional(),
});

const userPatchSchema = z.object({
  name: shortText(120).min(1).optional(),
  role: z.enum(["owner", "admin", "staff", "accountant"]).optional(),
  email: email.optional(),
  password: password.optional(),
});

// currentPassword is required unless the account has never had one
// (created from HordeMart) — the route decides.
const passwordChangeSchema = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword: password,
});

const consentSchema = z.object({
  purpose: z.enum(PURPOSES),
  version: z.string().max(40),
  accept: z.literal(true),
});

const ssoExchangeSchema = z.object({ token: z.string().min(1).max(4096) });

const ssoConfirmSchema = z.object({
  ticket: z.string().min(1).max(200),
  acceptTerms: z.literal(true),
  termsVersion: z.literal(CONSENT_VERSIONS.hordemart),
  acceptAppTerms: z.literal(true),
  appTermsVersion: z.literal(CONSENT_VERSIONS.terms),
});

// What HordeMart sends when an order is paid. No customer details, no amounts.
const saleEventSchema = z.object({
  event: z.literal("order.paid"),
  siteId: z.string().min(1).max(64),
  orderNumber: z.string().min(1).max(64),
  paidAt: z.string().datetime({ offset: true }).optional(),
  items: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(64),
        quantity: z.number().int().positive().max(1_000_000),
      })
    )
    .min(1)
    .max(500),
});

// Run a schema; on failure answer 400 with the first problem and return null.
function parseBody(schema, req, res) {
  const result = schema.safeParse(req.body ?? {});
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  res.status(400).json({
    error: issue?.message || "Check the form and try again",
    field: issue?.path?.join(".") || undefined,
    code: "VALIDATION_FAILED",
  });
  return null;
}

module.exports = {
  PASSWORD_MIN,
  signupSchema,
  loginSchema,
  inviteSchema,
  userPatchSchema,
  passwordChangeSchema,
  consentSchema,
  ssoExchangeSchema,
  ssoConfirmSchema,
  saleEventSchema,
  parseBody,
};

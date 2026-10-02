import React, { useState } from "react";
import {
  Building2,
  Landmark,
  MapPin,
  Phone,
  Briefcase,
  Mail,
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
  ArrowRight,
  Loader2,
  CheckCircle2,
  Users,
  Smartphone,
  Building,
} from "lucide-react";
import mrMouseImg from "./background images/mrmouse1.png";
import { useAuth } from "./useAuth";
import { PLAN_TIERS } from "./planTiers";
import { GlobalStyle } from "./booksofacc/ui";
import ConsentCheckbox from "./legal/ConsentCheckbox";
import LegalModal from "./legal/LegalModal";
import { CONSENTS } from "./legal/legal";

const INDUSTRIES = [
  "Retail & trade",
  "Manufacturing",
  "Professional services",
  "Real estate & construction",
  "Hospitality & food",
  "Technology",
  "Agriculture",
  "Logistics & transport",
  "Healthcare",
  "Other",
];

const emptySignup = {
  name: "",
  businessName: "",
  cac: "",
  location: "",
  contact: "",
  industry: "",
  email: "",
  password: "",
  planTier: "solo",
  companySeats: 3,
};

const emptySignin = { email: "", password: "" };

// This is where the app finally has real accountability: `user.businessId`
// IS the companyId used everywhere else (useCompanySync, RequireDeviceSlot,
// etc.) — no more hashing businessName+contact together. And every ledger
// entry can now be attributed to `user.id` / `user.name`, which is the
// point of moving to real login in the first place.
export default function LoginPage({ onAuthenticated }) {
  const { signupNewCompany, login } = useAuth();

  const [mode, setMode] = useState("signup");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState("idle");
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");

  const [signup, setSignup] = useState(emptySignup);
  const [signin, setSignin] = useState(emptySignin);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [doc, setDoc] = useState(null);

  const setSignupField = (key, value) => {
    setSignup((s) => ({ ...s, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const setSigninField = (key, value) => {
    setSignin((s) => ({ ...s, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const validate = () => {
    const next = {};
    if (mode === "signup") {
      if (!signup.name.trim()) next.name = "Enter your name";
      if (!signup.businessName.trim()) next.businessName = "Enter your business name";
      if (!signup.location.trim()) next.location = "Enter your business location";
      if (!signup.contact.trim()) next.contact = "Enter a contact number";
      if (!signup.industry) next.industry = "Select an industry";
      if (!signup.email.trim()) next.email = "Enter an email address";
      if (!signup.password || signup.password.length < 12) next.password = "Use at least 12 characters — a short sentence works well";
      if (!acceptTerms) next.acceptTerms = "Tick the box to accept the Terms and Privacy Policy";
      if (signup.planTier === "company" && (!signup.companySeats || signup.companySeats < 1))
        next.companySeats = "Enter at least 1 seat";
    } else {
      if (!signin.email.trim()) next.email = "Enter your email";
      if (!signin.password) next.password = "Enter your password";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError("");
    if (!validate()) return;
    setStatus("submitting");

    try {
      let user;
      if (mode === "signup") {
        const plan =
          signup.planTier === "company"
            ? { tier: "company", maxDevices: Number(signup.companySeats) }
            : { tier: signup.planTier, maxDevices: PLAN_TIERS[signup.planTier].maxDevices };

        const result = await signupNewCompany({
          email: signup.email,
          name: signup.name,
          password: signup.password,
          businessName: signup.businessName,
          cac: signup.cac,
          location: signup.location,
          contact: signup.contact,
          industry: signup.industry,
          plan,
          acceptTerms: true,
          termsVersion: CONSENTS.terms.version,
        });
        user = result.user; // role: "owner" — first user of a new company always is
      } else {
        user = await login({ email: signin.email, password: signin.password });
      }

      setStatus("done");
      setTimeout(() => {
        if (onAuthenticated) onAuthenticated(user);
      }, 700);
    } catch (err) {
      setStatus("idle");
      setServerError(err.message || "Something went wrong — try again.");
    }
  };

  const switchMode = (next) => {
    setMode(next);
    setStatus("idle");
    setErrors({});
    setServerError("");
    setShowPassword(false);
  };

  return (
    <div className="min-h-screen w-full bg-paper font-body flex items-center justify-center p-4 sm:p-8">
      <GlobalStyle />
      <style>{`
        /* Login-specific: the plan picker's scroll area wants a thinner
           thumb than the app-wide one in GlobalStyle. */
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: color-mix(in srgb, var(--color-ink) 15%, transparent);
          border-radius: 4px;
        }
      `}</style>

      <div className="w-full max-w-5xl bg-white rounded-3xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 border border-ink/10 min-h-[620px]">

        <div className="lg:col-span-6 xl:col-span-6 p-6 sm:p-10 flex flex-col justify-between bg-white z-10">
          <div>
            <div className="flex items-center gap-2 mb-8">
              <div className="w-7 h-7 rounded-full border border-ink/25 bg-paper flex items-center justify-center">
                <div className="w-1.5 h-1.5 rounded-full bg-action" />
              </div>
              <span className="font-display text-base font-semibold text-ink">Mr Mouse</span>
            </div>

            {status === "done" ? (
              <div className="py-12 text-center">
                <CheckCircle2 className="mx-auto mb-4 text-moss" size={42} />
                <h2 className="font-display text-2xl mb-2 text-ink">
                  {mode === "signup" ? "Account created" : "Welcome back"}
                </h2>
                <p className="font-body text-sm text-ink/60">
                  {mode === "signup"
                    ? "You're set up as the owner. Taking you to your dashboard."
                    : "Taking you to your dashboard."}
                </p>
              </div>
            ) : (
              <>
                <h1 className="font-display text-2xl sm:text-3xl font-medium text-ink mb-1">
                  {mode === "signup" ? "Set up your business" : "Welcome Back!"}
                </h1>
                <p className="font-body text-xs sm:text-sm text-ink/60 mb-6">
                  {mode === "signup"
                    ? "A few details, then your books are ready to go. You'll be the owner of this account."
                    : "Please log in to your account."}
                </p>

                {serverError && (
                  <div className="mb-4 rounded-lg bg-clay/10 border border-clay/30 px-3 py-2">
                    <p className="font-body text-xs text-clay">{serverError}</p>
                  </div>
                )}

                <form onSubmit={handleSubmit} noValidate>
                  {mode === "signup" ? (
                    <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                      <EntryField icon={UserIcon} label="Your name" error={errors.name}>
                        <input
                          className="ledger-input w-full py-1.5 text-sm"
                          placeholder="e.g., Ugochukwu Nnoruga"
                          value={signup.name}
                          onChange={(e) => setSignupField("name", e.target.value)}
                        />
                      </EntryField>

                      <EntryField icon={Building2} label="Business name" error={errors.businessName}>
                        <input
                          className="ledger-input w-full py-1.5 text-sm"
                          placeholder="e.g., Adaeze Foods Ltd"
                          value={signup.businessName}
                          onChange={(e) => setSignupField("businessName", e.target.value)}
                        />
                      </EntryField>

                      <EntryField icon={Landmark} label="CAC registration number" optional>
                        <input
                          className="ledger-input w-full py-1.5 text-sm"
                          placeholder="RC1234567 (optional)"
                          value={signup.cac}
                          onChange={(e) => setSignupField("cac", e.target.value)}
                        />
                      </EntryField>

                      <EntryField icon={MapPin} label="Business location" error={errors.location}>
                        <input
                          className="ledger-input w-full py-1.5 text-sm"
                          placeholder="e.g., Ikeja, Lagos"
                          value={signup.location}
                          onChange={(e) => setSignupField("location", e.target.value)}
                        />
                      </EntryField>

                      <EntryField icon={Phone} label="Business contact" error={errors.contact}>
                        <input
                          type="tel"
                          className="ledger-input w-full py-1.5 text-sm"
                          placeholder="e.g., 0803 123 4567"
                          value={signup.contact}
                          onChange={(e) => setSignupField("contact", e.target.value)}
                        />
                      </EntryField>

                      <EntryField icon={Briefcase} label="Industry" error={errors.industry}>
                        <select
                          className="ledger-input w-full py-1.5 text-sm appearance-none"
                          value={signup.industry}
                          onChange={(e) => setSignupField("industry", e.target.value)}
                        >
                          <option value="" disabled>Select industry</option>
                          {INDUSTRIES.map((ind) => (
                            <option key={ind} value={ind}>{ind}</option>
                          ))}
                        </select>
                      </EntryField>

                      <Field icon={Mail} label="Email" error={errors.email}>
                        <input
                          type="email"
                          className="ledger-input w-full py-1.5 text-sm"
                          placeholder="you@business.com"
                          value={signup.email}
                          onChange={(e) => setSignupField("email", e.target.value)}
                        />
                      </Field>

                      <Field
                        icon={Lock}
                        label="Password"
                        error={errors.password}
                        action={
                          <button
                            type="button"
                            onClick={() => setShowPassword((s) => !s)}
                            className="text-ink/35 hover:text-ink/70"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        }
                      >
                        <input
                          type={showPassword ? "text" : "password"}
                          className="ledger-input w-full py-1.5 text-sm"
                          placeholder="At least 6 characters"
                          value={signup.password}
                          onChange={(e) => setSignupField("password", e.target.value)}
                        />
                      </Field>

                      {/* Plan selection — chosen now, changeable later by the owner */}
                      <div>
                        <label className="font-body text-[13px] text-ink-soft mb-2 block">
                          Plan
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                          <PlanOption
                            icon={Smartphone}
                            label="Solo"
                            sub="1 device"
                            active={signup.planTier === "solo"}
                            onClick={() => setSignupField("planTier", "solo")}
                          />
                          <PlanOption
                            icon={Users}
                            label="Duo"
                            sub="2 devices"
                            active={signup.planTier === "duo"}
                            onClick={() => setSignupField("planTier", "duo")}
                          />
                          <PlanOption
                            icon={Building}
                            label="Company"
                            sub="Custom"
                            active={signup.planTier === "company"}
                            onClick={() => setSignupField("planTier", "company")}
                          />
                        </div>
                        <p className="font-body text-[11px] text-ink/40 mt-2">
                          You can change this later from account settings.
                        </p>

                        {signup.planTier === "company" && (
                          <div className="mt-3">
                            <EntryField n="" icon={Users} label="Number of seats" error={errors.companySeats}>
                              <input
                                type="number"
                                min="1"
                                className="ledger-input w-full py-1.5 text-sm"
                                placeholder="e.g., 5"
                                value={signup.companySeats}
                                onChange={(e) => setSignupField("companySeats", e.target.value)}
                              />
                            </EntryField>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-5 my-8">
                      <Field icon={Mail} label="Email" error={errors.email}>
                        <input
                          type="email"
                          className="ledger-input w-full py-2 text-sm"
                          placeholder="you@business.com"
                          value={signin.email}
                          onChange={(e) => setSigninField("email", e.target.value)}
                        />
                      </Field>
                      <Field
                        icon={Lock}
                        label="Password"
                        error={errors.password}
                        action={
                          <button
                            type="button"
                            onClick={() => setShowPassword((s) => !s)}
                            className="text-ink/35 hover:text-ink/70"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        }
                      >
                        <input
                          type={showPassword ? "text" : "password"}
                          className="ledger-input w-full py-2 text-sm"
                          placeholder="Your password"
                          value={signin.password}
                          onChange={(e) => setSigninField("password", e.target.value)}
                        />
                      </Field>
                    </div>
                  )}

                  {mode === "signup" && (
                    <div className="mt-6">
                      <ConsentCheckbox id="signup-terms" checked={acceptTerms} onChange={(v) => { setAcceptTerms(v); if (errors.acceptTerms) setErrors((e) => ({ ...e, acceptTerms: undefined })); }}>
                        I have read and agree to the Mr Mouse{" "}
                        <button type="button" className="underline text-action" onClick={() => setDoc("terms")}>
                          Terms of Service
                        </button>{" "}
                        and{" "}
                        <button type="button" className="underline text-action" onClick={() => setDoc("privacy")}>
                          Privacy Policy
                        </button>
                        .
                      </ConsentCheckbox>
                      {errors.acceptTerms && (
                        <p role="alert" className="mt-2 font-body text-[12px] text-clay">{errors.acceptTerms}</p>
                      )}
                    </div>
                  )}

                  <div className="mt-6 flex flex-col sm:flex-row items-center gap-3">
                    <button
                      type="submit"
                      disabled={status === "submitting" || (mode === "signup" && !acceptTerms)}
                      className="w-full flex-1 flex items-center justify-center gap-2 rounded-xl bg-action text-white font-body text-sm font-medium py-3 px-6 hover:bg-action-deep transition-colors disabled:opacity-70"
                    >
                      {status === "submitting" ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          {mode === "signup" ? "Creating account" : "Signing in"}
                        </>
                      ) : (
                        <>
                          {mode === "signup" ? "Create account" : "Login"}
                          <ArrowRight size={16} />
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => switchMode(mode === "signup" ? "signin" : "signup")}
                      className="w-full sm:w-auto px-5 py-3 rounded-xl border border-ink/20 text-ink text-sm font-medium hover:bg-paper transition-colors text-center"
                    >
                      {mode === "signup" ? "Sign in" : "Create account"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>

          <p className="font-body text-[11px] text-ink/50 mt-6">
            <button type="button" className="underline" onClick={() => setDoc("terms")}>Terms of Service</button>
            {" · "}
            <button type="button" className="underline" onClick={() => setDoc("privacy")}>Privacy Policy</button>
          </p>
          <LegalModal doc={doc} onClose={() => setDoc(null)} />
        </div>

        <div className="lg:col-span-6 xl:col-span-6 relative bg-ink hidden lg:block overflow-hidden">
          <img src={mrMouseImg} alt="Ledgerly Illustration" className="w-full h-full object-cover object-center" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent pointer-events-none" />
        </div>
      </div>
    </div>
  );
}

function Field({ icon: Icon, label, error, action, children }) {
  return (
    <div className={error ? "ledger-field-error" : ""}>
      <label className="font-body text-[13px] text-ink-soft flex items-center gap-1.5 mb-1">
        <Icon size={11} />
        {label}
      </label>
      <div className="flex items-center gap-2">
        <div className="flex-1">{children}</div>
        {action}
      </div>
      {error && <p className="font-body text-xs text-clay mt-1">{error}</p>}
    </div>
  );
}

function EntryField({ icon: Icon, label, error, optional, children }) {
  return (
    <div className={error ? "ledger-field-error" : ""}>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="font-body text-[13px] text-ink-soft flex items-center gap-1.5 mb-1">
            <Icon size={11} />
            {label}
            {optional && <span className="normal-case text-ink/30">(optional)</span>}
          </label>
          {children}
          {error && <p className="font-body text-xs text-clay mt-1">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function PlanOption({ icon: Icon, label, sub, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-lg border-2 py-3 transition-all ${
        active ? "border-action bg-action-sunk" : "border-rule bg-white"
      }`}
    >
      <Icon size={16} className={active ? "text-action" : "text-ink/50"} />
      <span className={`font-body text-xs font-medium ${active ? "text-ink" : "text-ink/60"}`}>{label}</span>
      <span className="font-mono text-[10px] text-ink/40">{sub}</span>
    </button>
  );
}

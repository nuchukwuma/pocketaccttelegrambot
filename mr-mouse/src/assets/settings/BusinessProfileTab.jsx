import React, { useEffect, useRef, useState } from "react";
import { Building2, Camera, Check, ImagePlus, Loader2, MapPin, Palette, Phone, Trash2, Wand2 } from "lucide-react";
import { useLedger } from "../booksofacc/Ledgercontext";
import { Field } from "../booksofacc/ui";
import BusinessAvatar from "../components/BusinessAvatar";
import InvoiceLetterhead, { PAPER_VARS } from "../booksofacc/InvoiceLetterhead";
import { ImageError } from "../media/images";
import { contrast, fitAccent, isHex } from "../theme/palette";
import { DEFAULT_THEME } from "../theme/tokens";

/* Settings → Business profile: logo, name, address, phone and brand
   colour. The logo and colour go on the top bar, the dashboard, the
   sign-in screen, printed invoices and WhatsApp invoices. */

const SUGGESTED = ["#22307a", "#0b6283", "#2f5741", "#b33c0a", "#5b2a9e", "#a8234f", "#7d5410", "#2e3238"];
const PAPER = { surface: "#ffffff", paper: "#ffffff", action: DEFAULT_THEME.colors.action };
const PHONE = /^[0-9+()\-\s]{7,20}$/;

function validate(form) {
  const errors = {};
  if (!form.businessName.trim()) errors.businessName = "Your business needs a name.";
  else if (form.businessName.trim().length > 200) errors.businessName = "Keep the name under 200 characters.";
  if (form.location.trim().length > 300) errors.location = "Keep the address under 300 characters.";
  if (form.contact.trim() && !PHONE.test(form.contact.trim())) errors.contact = "Use digits only, e.g. 0803 123 4567 or +234 803 123 4567.";
  if (form.brandColor && !isHex(form.brandColor)) errors.brandColor = "Pick a colour, or type one like #22307a.";
  return errors;
}

export default function BusinessProfileTab() {
  const { business, saveBusinessProfile, saveImage, deleteImage } = useLedger();
  const initial = () => ({
    businessName: business?.businessName || "",
    location: business?.location || "",
    contact: business?.contact || "",
    brandColor: business?.brandColor || "",
  });
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState(null); // { tone, text }
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState("");
  const uploadRef = useRef(null);
  const cameraRef = useRef(null);

  // Another device changed the profile: show it, unless this form has edits.
  const savedKey = `${business?.businessName}|${business?.location}|${business?.contact}|${business?.brandColor}`;
  const dirty =
    form.businessName !== (business?.businessName || "") ||
    form.location !== (business?.location || "") ||
    form.contact !== (business?.contact || "") ||
    (form.brandColor || "") !== (business?.brandColor || "");
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!dirtyRef.current) setForm(initial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setStatus(null);
  };

  // Brand colour must read on white paper (the invoice title is drawn in it).
  const brandRatio = isHex(form.brandColor) ? contrast(form.brandColor, "#ffffff") : null;
  const brandTooLight = brandRatio !== null && brandRatio < 4.5;
  const brandFix = brandTooLight ? fitAccent(form.brandColor, PAPER, "light").color : null;

  async function save(e) {
    e.preventDefault();
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length || brandTooLight) return;
    setSaving(true);
    const result = await saveBusinessProfile({
      businessName: form.businessName.trim(),
      location: form.location.trim(),
      contact: form.contact.trim(),
      brandColor: form.brandColor ? form.brandColor.toLowerCase() : null,
    });
    setSaving(false);
    setStatus(result?.ok ? { tone: "good", text: "Saved. Your other devices update in a moment." } : { tone: "bad", text: result?.error || "Couldn't save. Try again." });
  }

  async function applyLogo(file) {
    if (!file) return;
    setLogoError("");
    setLogoBusy(true);
    const previous = business?.logoImageId || null;
    try {
      const id = await saveImage(file, { kind: "logo" });
      const result = await saveBusinessProfile({ logoImageId: id });
      if (!result?.ok) {
        await deleteImage(id);
        setLogoError(result?.error || "Couldn't save the logo. Try again.");
        return;
      }
      if (previous) await deleteImage(previous);
    } catch (err) {
      setLogoError(err instanceof ImageError ? err.message : "Couldn't use that picture. Try another one.");
    } finally {
      setLogoBusy(false);
      if (uploadRef.current) uploadRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  }

  async function removeLogo() {
    const previous = business?.logoImageId;
    if (!previous) return;
    setLogoError("");
    setLogoBusy(true);
    const result = await saveBusinessProfile({ logoImageId: null });
    if (result?.ok) await deleteImage(previous);
    else setLogoError(result?.error || "Couldn't remove the logo. Try again.");
    setLogoBusy(false);
  }

  const preview = { ...business, ...form, brandColor: isHex(form.brandColor) ? form.brandColor : null };

  return (
    <div className="space-y-6">
      {/* ---- Logo ---- */}
      <section className="rounded-lg border border-rule bg-surface p-5 sm:p-6" aria-labelledby="logo-heading">
        <h2 id="logo-heading" className="font-display text-lg text-ink">Logo</h2>
        <p className="font-body text-sm text-ink-soft mt-1 mb-4">
          Shown in the top bar, on Home, on the sign-in screen and on your invoices. Without one, your initials are used.
        </p>
        <div className="flex flex-wrap items-center gap-5">
          <BusinessAvatar business={preview} size={88} className="border border-rule" />
          <div className="flex flex-wrap gap-2">
            <input
              ref={uploadRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
              className="sr-only"
              id="logo-upload"
              onChange={(e) => applyLogo(e.target.files?.[0])}
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              id="logo-camera"
              onChange={(e) => applyLogo(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => uploadRef.current?.click()}
              disabled={logoBusy}
              className="flex items-center gap-2 rounded-md bg-action px-4 min-h-tap font-body text-sm font-medium text-on-action hover:bg-action-deep disabled:opacity-60"
            >
              {logoBusy ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
              {business?.logoImageId ? "Replace logo" : "Upload logo"}
            </button>
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={logoBusy}
              className="flex items-center gap-2 rounded-md border border-rule px-4 min-h-tap font-body text-sm text-ink disabled:opacity-60"
            >
              <Camera size={16} /> Take a photo
            </button>
            {business?.logoImageId && (
              <button
                type="button"
                onClick={removeLogo}
                disabled={logoBusy}
                className="flex items-center gap-2 rounded-md border border-clay/30 px-4 min-h-tap font-body text-sm text-clay disabled:opacity-60"
              >
                <Trash2 size={16} /> Remove
              </button>
            )}
          </div>
        </div>
        <p className="font-body text-caption text-ink-soft mt-3" aria-live="polite">
          {logoBusy ? "Preparing your logo…" : "PNG, JPG or WebP, up to 10 MB. It's resized to 512px so it syncs quickly."}
        </p>
        {logoError && (
          <p role="alert" className="font-body text-sm text-clay mt-2">
            {logoError}
          </p>
        )}
      </section>

      {/* ---- Details ---- */}
      <form onSubmit={save} noValidate className="rounded-lg border border-rule bg-surface p-5 sm:p-6 space-y-5" aria-labelledby="details-heading">
        <h2 id="details-heading" className="font-display text-lg text-ink">Details</h2>

        <Field icon={Building2} label="Business name" error={errors.businessName}>
          <input value={form.businessName} onChange={set("businessName")} maxLength={200} className="ledger-input w-full py-2 text-sm" autoComplete="organization" />
        </Field>
        <Field icon={MapPin} label="Address" optional error={errors.location}>
          <input value={form.location} onChange={set("location")} maxLength={300} placeholder="e.g. Shop 14, Balogun Market, Lagos Island" className="ledger-input w-full py-2 text-sm" autoComplete="street-address" />
        </Field>
        <Field icon={Phone} label="Phone" optional error={errors.contact}>
          <input value={form.contact} onChange={set("contact")} inputMode="tel" placeholder="e.g. 0803 123 4567" className="ledger-input w-full py-2 text-sm" autoComplete="tel" />
        </Field>

        <div>
          <p className="font-body text-label text-ink-soft flex items-center gap-1.5 mb-2">
            <Palette size={13} /> Brand colour <span className="text-ink/35">(optional)</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {SUGGESTED.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => setForm((f) => ({ ...f, brandColor: hex }))}
                aria-label={`Use ${hex}`}
                aria-pressed={form.brandColor.toLowerCase() === hex}
                className="w-9 h-9 rounded-full border-2 flex items-center justify-center"
                style={{ background: hex, borderColor: form.brandColor.toLowerCase() === hex ? "var(--color-ink)" : "transparent" }}
              >
                {form.brandColor.toLowerCase() === hex && <Check size={15} color="#fff" />}
              </button>
            ))}
            <label className="flex items-center gap-2 rounded-md border border-rule px-2 min-h-tap font-body text-sm text-ink cursor-pointer">
              <input
                type="color"
                value={isHex(form.brandColor) ? form.brandColor : "#22307a"}
                onChange={set("brandColor")}
                className="w-7 h-7 border-0 bg-transparent p-0 cursor-pointer"
                aria-label="Pick any colour"
              />
              Any colour
            </label>
            <input
              value={form.brandColor}
              onChange={set("brandColor")}
              placeholder="#22307a"
              aria-label="Brand colour as a hex code"
              className="ledger-input w-24 py-2 text-sm font-mono"
              maxLength={7}
            />
            {form.brandColor && (
              <button type="button" onClick={() => setForm((f) => ({ ...f, brandColor: "" }))} className="font-body text-label text-ink-soft underline min-h-tap px-1">
                None
              </button>
            )}
          </div>
          {errors.brandColor && <p className="font-body text-xs text-clay mt-1">{errors.brandColor}</p>}
          {brandRatio !== null && (
            <p className={`font-body text-label mt-2 ${brandTooLight ? "text-clay" : "text-moss"}`} role="status">
              {brandTooLight ? (
                <>
                  Too light to read on a white invoice (contrast {brandRatio.toFixed(1)}:1, needs 4.5:1).{" "}
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, brandColor: brandFix }))}
                    className="inline-flex items-center gap-1 underline font-medium"
                  >
                    <Wand2 size={13} /> Use {brandFix} instead
                  </button>
                </>
              ) : (
                <>Readable on white paper (contrast {brandRatio.toFixed(1)}:1).</>
              )}
            </p>
          )}
        </div>

        <div>
          <p className="font-body text-label text-ink-soft mb-2">How your invoices will look</p>
          <div className="rounded-lg border border-rule bg-surface p-5" style={PAPER_VARS}>
            <InvoiceLetterhead business={preview} number="INV-001" date={new Date().toISOString().slice(0, 10)} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={saving || !dirty || brandTooLight}
            className="flex items-center gap-2 rounded-md bg-action px-5 min-h-tap font-body text-sm font-medium text-on-action hover:bg-action-deep disabled:opacity-50"
          >
            {saving && <Loader2 size={16} className="animate-spin" />} Save details
          </button>
          {status && (
            <p role={status.tone === "bad" ? "alert" : "status"} className={`font-body text-sm ${status.tone === "bad" ? "text-clay" : "text-moss"}`}>
              {status.text}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}

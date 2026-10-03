import React from "react";
import { FileText } from "lucide-react";
import { Modal } from "../booksofacc/ui";
import { PrivacyPolicy, TermsOfService } from "./documents";

/** Shows "terms" or "privacy" over the current screen. */
export default function LegalModal({ doc, onClose }) {
  if (!doc) return null;
  return (
    <Modal title={doc === "privacy" ? "Privacy Policy" : "Terms of Service"} icon={FileText} onClose={onClose} wide dismissOnBackdrop>
      <div className="max-h-[60vh] overflow-y-auto pr-1">{doc === "privacy" ? <PrivacyPolicy /> : <TermsOfService />}</div>
    </Modal>
  );
}

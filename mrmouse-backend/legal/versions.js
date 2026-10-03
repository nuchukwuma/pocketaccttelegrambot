// legal/versions.js
// The version of each thing people agree to. Must equal CONSENTS[purpose].version
// in the app (mr-mouse/src/assets/legal/legal.js). Bump both together when a
// text changes in substance: everyone is asked again, because an old version
// no longer counts as agreement.

const CONSENT_VERSIONS = Object.freeze({
  terms: "2026-10-02",
  ai: "2026-10-02",
  telegram: "2026-10-02",
  whatsapp: "2026-10-02",
  hordemart: "2026-10-02",
});

const PURPOSES = Object.freeze(Object.keys(CONSENT_VERSIONS));

module.exports = { CONSENT_VERSIONS, PURPOSES };

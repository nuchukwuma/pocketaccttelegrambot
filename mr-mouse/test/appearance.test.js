// Colour presets, custom accents, the glossary and the tour's steps.
// Pure modules only, so these run on plain Node: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PRESETS, checkContrast, contrast, fitAccent, resolveThemePref } from "../src/assets/theme/palette.js";
import { COLOR_TOKENS, DEFAULT_THEME } from "../src/assets/theme/tokens.js";
import { GLOSSARY, searchGlossary } from "../src/assets/help/glossary.js";
import { TOUR_STEPS, stepIndex } from "../src/assets/tour/steps.js";

test("every preset defines every colour token", () => {
  for (const preset of PRESETS) {
    const missing = COLOR_TOKENS.filter((name) => !preset.colors[name]);
    assert.deepEqual(missing, [], `${preset.id} is missing ${missing.join(", ")}`);
  }
});

test("every preset passes every readability check", () => {
  for (const preset of PRESETS) {
    const failing = checkContrast(preset.colors).filter((c) => !c.ok);
    assert.deepEqual(failing, [], `${preset.id}: ${failing.map((f) => `${f.label} ${f.ratio}:1`).join(", ")}`);
  }
});

test("the presets the user asked for are all there, with exactly one dark theme", () => {
  const ids = PRESETS.map((p) => p.id);
  for (const id of ["forest", "ocean", "sunset", "royal", "rose", "midnight", "sand", "charcoal"]) assert.ok(ids.includes(id), id);
  assert.deepEqual(PRESETS.filter((p) => p.scheme === "dark").map((p) => p.id), ["midnight"]);
});

test("the default preset is the palette index.css ships with", () => {
  assert.deepEqual(PRESETS[0].colors, DEFAULT_THEME.colors);
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  for (const [name, value] of Object.entries(DEFAULT_THEME.colors)) {
    assert.ok(css.includes(`--color-${name}: ${value}`), `index.css --color-${name} should be ${value}`);
  }
});

test("a custom accent is nudged until it reads, on light and dark themes", () => {
  for (const presetId of ["hordemart", "midnight", "sand"]) {
    for (const accent of ["#ffff00", "#ffffff", "#000000", "#e91e63", "#7fdbff"]) {
      const theme = resolveThemePref({ preset: presetId, accent });
      const failing = checkContrast(theme.colors).filter((c) => !c.ok);
      assert.deepEqual(failing, [], `${presetId} + ${accent}`);
    }
  }
  // A colour that already works is kept as it is.
  assert.deepEqual(fitAccent("#22307a", PRESETS[0].colors), { color: "#22307a", adjusted: false });
});

test("a malformed theme preference falls back to the default", () => {
  for (const value of [null, undefined, {}, { preset: "nope" }, { preset: "ocean", accent: "red" }, "midnight"]) {
    const theme = resolveThemePref(value);
    assert.ok(theme.colors.paper);
  }
  assert.equal(resolveThemePref({ preset: "ocean", accent: "red" }).id, "ocean");
});

test("contrast matches the WCAG reference values", () => {
  assert.equal(Math.round(contrast("#000000", "#ffffff") * 10) / 10, 21);
  assert.equal(Math.round(contrast("#777777", "#ffffff") * 100) / 100, 4.48);
});

test("the glossary keeps all twelve terms, each with an example in Naira", () => {
  assert.equal(GLOSSARY.length, 12);
  for (const g of GLOSSARY) assert.match(g.example, /₦/, g.term);
});

test("glossary search matches every word, in any field, ignoring case", () => {
  assert.equal(searchGlossary("").length, 12);
  assert.deepEqual(searchGlossary("VAT").map((g) => g.term), ["VAT Payable"]);
  assert.ok(searchGlossary("owe").some((g) => g.term === "Debtors"));
  assert.deepEqual(searchGlossary("zzzz"), []);
});

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(jsx?|tsx?)$/.test(name) ? [path] : [];
  });
}

test("every tour step highlights an element that exists in the app", () => {
  const source = sourceFiles(new URL("../src", import.meta.url).pathname)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  for (const step of TOUR_STEPS) {
    const found = step.target.startsWith("nav-")
      ? source.includes("data-tour={`nav-${item.key}`}") && source.includes(`key: "${step.target.slice(4)}"`)
      : source.includes(`data-tour="${step.target}"`);
    assert.ok(found, `${step.id}: no data-tour="${step.target}"`);
    assert.ok(step.how && step.why, `${step.id} needs both texts`);
  }
});

test("the tour covers the six screens, and unknown progress restarts it", () => {
  const screens = TOUR_STEPS.map((s) => s.params?.book || s.page);
  for (const screen of ["dashboard", "addentry", "cashbook", "inventory", "invoice", "pnlstatement"]) assert.ok(screens.includes(screen), screen);
  assert.equal(stepIndex("inventory"), TOUR_STEPS.findIndex((s) => s.id === "inventory"));
  assert.equal(stepIndex("removed-step"), 0);
  assert.equal(new Set(TOUR_STEPS.map((s) => s.id)).size, TOUR_STEPS.length);
});

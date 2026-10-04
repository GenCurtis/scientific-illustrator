// Verifies the P3a perceptual QA core: unit conversions, render-context
// normalization, comparison semantics, the deterministic checks (font scale,
// effective DPI, line weight, contrast, grayscale, thumbnail), the faithful
// recreation policy downgrade, and input tolerance. Pure-module tests only;
// backend integration arrives in P3b.
import assert from "node:assert/strict";
import {
  PERCEPTUAL_MODEL_SCHEMA_VERSION,
  contrastRatio,
  evaluatePerceptualQa,
  grayscaleLuminance,
  meetsComparison,
  normalizeRenderContext,
  ptFromMm,
  ptFromPx,
  readRuleToken,
  relativeLuminance,
} from "../plugins/scientific-illustrator/scripts/perceptual-qa.mjs";

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok - ${name}`);
}

function makeModel(overrides = {}) {
  return {
    schema: PERCEPTUAL_MODEL_SCHEMA_VERSION,
    canvas: { width_pt: 720, height_pt: 540 },
    elements: [
      { name: "Title", kind: "text", font_pt: 18, color: "#222222", fill: "#FFFFFF" },
      { name: "Micrograph", kind: "picture", pixel_width: 300, pixel_height: 225, placed_width_pt: 72, placed_height_pt: 54 },
      { name: "Box", kind: "shape", line_pt: 0.5, fill: "#2166AC", line: "#000000" },
    ],
    ...overrides,
  };
}

const categories = (result) => result.findings.map((finding) => finding.category);
const PUBLICATION_90MM = { id: "publication", width_mm: 90 };

await check("unit conversions use physical reference units", async () => {
  assert.ok(Math.abs(ptFromMm(25.4) - 72) < 1e-9);
  assert.ok(Math.abs(ptFromPx(96) - 72) < 1e-9);
  assert.ok(Math.abs(ptFromMm(90) - 255.11811023622047) < 1e-9);
});

await check("render contexts normalize strings, mm and px targets", async () => {
  assert.deepEqual(normalizeRenderContext("publication"), { id: "publication", unit: null, target_width_pt: null });
  assert.deepEqual(normalizeRenderContext("  publication  "), { id: "publication", unit: null, target_width_pt: null });
  assert.equal(normalizeRenderContext({ id: "publication", width_mm: 90 }).unit, "mm");
  assert.ok(Math.abs(normalizeRenderContext({ id: "thumbnail", width_px: 300 }).target_width_pt - 225) < 1e-9);
  assert.equal(normalizeRenderContext({ id: "screen" }).target_width_pt, null);
  assert.equal(normalizeRenderContext({ id: "x", width_mm: 90, width_px: 300 }), null);
  assert.equal(normalizeRenderContext({ id: "", width_mm: 90 }), null);
  assert.equal(normalizeRenderContext(42), null);
});

await check("invalid render context entries are reported instead of misread", async () => {
  const result = evaluatePerceptualQa({
    model: makeModel(),
    contexts: [
      { id: "publication", width_mm: 90, width_px: 300 },
      { id: "", width_mm: 90 },
      42,
      { id: "screen", width_mm: -1 },
      { id: "publication", width_mm: 0 },
    ],
    rules: { min_font_pt: 7 },
  });
  assert.equal(result.contexts.length, 0);
  assert.equal(result.invalid_contexts.length, 5);
  assert.equal(result.invalid_contexts[0].index, 0);
  assert.match(result.invalid_contexts[0].reason, /mutually exclusive/);
  const declaredOnly = evaluatePerceptualQa({ model: makeModel(), contexts: [{ id: "screen" }], rules: {} });
  assert.equal(declaredOnly.contexts.length, 1);
  assert.deepEqual(declaredOnly.invalid_contexts, []);
  const inherited = Object.create({ width_mm: 90 });
  inherited.id = "screen";
  assert.equal(normalizeRenderContext(inherited).target_width_pt, null);
  assert.equal(normalizeRenderContext({ id: "  publication  ", width_mm: 90 }).id, "publication");
  assert.equal(normalizeRenderContext({ id: "screen", width_mm: undefined }).target_width_pt, null);
});

await check("non-array contexts are tolerated and reported", async () => {
  const nulled = evaluatePerceptualQa({ model: makeModel(), contexts: null, rules: {} });
  assert.deepEqual(nulled.contexts, []);
  assert.deepEqual(nulled.invalid_contexts, []);
  const stringed = evaluatePerceptualQa({ model: makeModel(), contexts: "publication", rules: {} });
  assert.equal(stringed.invalid_contexts.length, 1);
  assert.match(stringed.invalid_contexts[0].reason, /must be an array/);
  const objected = evaluatePerceptualQa({ model: makeModel(), contexts: { id: "publication" }, rules: {} });
  assert.equal(objected.invalid_contexts.length, 1);
});

await check("comparison semantics honor strict and inclusive thresholds", async () => {
  assert.equal(meetsComparison(300, 300, "greater-than"), false);
  assert.equal(meetsComparison(301, 300, "greater-than"), true);
  assert.equal(meetsComparison(300, 300, "greater-than-or-equal"), true);
  assert.equal(meetsComparison(299.9, 300, "greater-than-or-equal"), false);
  assert.equal(meetsComparison(300, 300), true);
  assert.equal(meetsComparison(Number.NaN, 300), false);
});

await check("color helpers compute WCAG contrast and grayscale luminance", async () => {
  assert.ok(Math.abs(contrastRatio("#000000", "#FFFFFF") - 21) < 1e-9);
  assert.equal(grayscaleLuminance("#FFFFFF"), 255);
  assert.equal(grayscaleLuminance("#000000"), 0);
  assert.equal(relativeLuminance("#FFFFFF"), 1);
  assert.equal(contrastRatio("not-a-color", "#FFFFFF"), null);
  assert.ok(Number.isFinite(contrastRatio("#abc", "#ffffff")));
  assert.ok(Math.abs(contrastRatio("#abc", "#ffffff") - 1.9645876970822407) < 1e-9);
});

await check("rule tokens never read inherited properties", async () => {
  assert.equal(readRuleToken({}, "toString"), undefined);
  assert.equal(readRuleToken({}, "constructor"), undefined);
  assert.equal(readRuleToken({ toString: 5 }, "toString"), 5);
  assert.equal(readRuleToken({ constructor: { value: 7 } }, "constructor"), 7);
});

await check("numeric string canvas widths coerce like numbers", async () => {
  const result = evaluatePerceptualQa({
    model: { canvas: { width_pt: "720" }, elements: [] },
    contexts: [PUBLICATION_90MM],
    rules: { min_font_pt: 7 },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.contexts[0].scale !== null, true);
});

await check("rule tokens read raw values and resolved entries", async () => {
  assert.equal(readRuleToken({ min_font_pt: 7 }, "min_font_pt"), 7);
  assert.equal(readRuleToken({ min_font_pt: { value: 8, source: "x" } }, "min_font_pt"), 8);
  assert.equal(readRuleToken({}, "min_font_pt"), undefined);
  assert.equal(readRuleToken(null, "min_font_pt"), undefined);
});

await check("font scale flags text below the profile minimum", async () => {
  const result = evaluatePerceptualQa({ model: makeModel(), contexts: [PUBLICATION_90MM], rules: { min_font_pt: 7 } });
  const finding = result.findings.find((entry) => entry.category === "font_size_below_minimum");
  assert.ok(finding, "18pt at 90mm delivery must fall below the 7pt minimum");
  assert.deepEqual(finding.objects, ["Title"]);
  assert.equal(finding.context, "publication");
  assert.equal(finding.rule_token, "min_font_pt");
  assert.equal(typeof finding.evidence, "string");
  assert.equal(typeof finding.correction, "string");
  assert.equal(typeof finding.acceptance, "string");
});

await check("font scale passes when the delivery size keeps text legible", async () => {
  const model = makeModel({ elements: [{ name: "Title", kind: "text", font_pt: 24, color: "#222222" }] });
  const result = evaluatePerceptualQa({ model, contexts: [PUBLICATION_90MM], rules: { min_font_pt: 7 } });
  assert.equal(categories(result).includes("font_size_below_minimum"), false);
});

await check("publisher full-size text minimum takes precedence over the profile default", async () => {
  const model = makeModel({ elements: [{ name: "Title", kind: "text", font_pt: 24, color: "#222222" }] });
  const result = evaluatePerceptualQa({
    model,
    contexts: [PUBLICATION_90MM],
    rules: { min_font_pt: 7, "fonts.full_size_text_min_pt": 9 },
  });
  const finding = result.findings.find((entry) => entry.category === "font_size_below_minimum");
  assert.ok(finding);
  assert.equal(finding.rule_token, "fonts.full_size_text_min_pt");
});

await check("effective DPI passes at the inclusive threshold", async () => {
  const result = evaluatePerceptualQa({
    model: makeModel(),
    contexts: [{ id: "publication", width_mm: 254 }],
    rules: { min_raster_dpi: 300 },
  });
  assert.equal(categories(result).includes("effective_dpi_below_minimum"), false);
});

await check("strict publisher comparisons reject the exact threshold", async () => {
  const rules = {
    "raster.color_grayscale.minimum_dpi": 300,
    "raster.color_grayscale.comparison": "greater-than",
  };
  const atThreshold = evaluatePerceptualQa({
    model: makeModel(),
    contexts: [{ id: "publication", width_mm: 254 }],
    rules,
    options: { raster_class: "color_grayscale" },
  });
  assert.equal(categories(atThreshold).includes("effective_dpi_below_minimum"), true);
  const above = makeModel({
    elements: [{ name: "Micrograph", kind: "picture", pixel_width: 302, pixel_height: 227, placed_width_pt: 72, placed_height_pt: 54 }],
  });
  const passing = evaluatePerceptualQa({
    model: above,
    contexts: [{ id: "publication", width_mm: 254 }],
    rules,
    options: { raster_class: "color_grayscale" },
  });
  assert.equal(categories(passing).includes("effective_dpi_below_minimum"), false);
});

await check("effective DPI falls back to the profile minimum", async () => {
  const model = makeModel({
    elements: [{ name: "Micrograph", kind: "picture", pixel_width: 150, pixel_height: 112, placed_width_pt: 72, placed_height_pt: 54 }],
  });
  const result = evaluatePerceptualQa({ model, contexts: [{ id: "publication", width_mm: 254 }], rules: { min_raster_dpi: 300 } });
  const finding = result.findings.find((entry) => entry.category === "effective_dpi_below_minimum");
  assert.ok(finding);
  assert.equal(finding.rule_token, "min_raster_dpi");
});

await check("effective DPI scales with the delivery context", async () => {
  const model = makeModel();
  const halfSize = evaluatePerceptualQa({
    model,
    contexts: [{ id: "publication", width_mm: 127 }],
    rules: { min_raster_dpi: 300 },
  });
  assert.equal(categories(halfSize).includes("effective_dpi_below_minimum"), false, "halving the delivery size doubles effective DPI");

  const doubled = evaluatePerceptualQa({
    model,
    contexts: [{ id: "publication", width_mm: 508 }],
    rules: { min_raster_dpi: 300 },
  });
  const finding = doubled.findings.find((entry) => entry.category === "effective_dpi_below_minimum");
  assert.ok(finding, "doubling the delivery size halves effective DPI");
  assert.match(finding.evidence, /150 dpi/);
});

await check("effective DPI uses the weaker of the two pixel ratios", async () => {
  const model = makeModel({
    elements: [{ name: "Wide", kind: "picture", pixel_width: 600, pixel_height: 50, placed_width_pt: 72, placed_height_pt: 54 }],
  });
  const result = evaluatePerceptualQa({ model, contexts: [{ id: "publication", width_mm: 254 }], rules: { min_raster_dpi: 300 } });
  assert.ok(
    result.findings.some((entry) => entry.category === "effective_dpi_below_minimum"),
    "the 66.7 dpi height ratio must fail even though the width ratio is 600 dpi"
  );
});

await check("DPI checks are skipped for screen-only pixel contexts", async () => {
  const result = evaluatePerceptualQa({
    model: makeModel(),
    contexts: [{ id: "screen", width_px: 1200 }],
    rules: { min_raster_dpi: 300 },
  });
  assert.equal(categories(result).includes("effective_dpi_below_minimum"), false);
});

await check("line weight checks enforce minimum and maximum tokens", async () => {
  const thin = makeModel({ elements: [{ name: "Box", kind: "shape", line_pt: 0.05 }] });
  const below = evaluatePerceptualQa({
    model: thin,
    contexts: [{ id: "publication", width_mm: 254 }],
    rules: { "line_weight_pt.minimum": 0.1 },
  });
  assert.equal(categories(below).includes("line_weight_below_minimum"), true);

  const thick = makeModel({ elements: [{ name: "Box", kind: "shape", line_pt: 2 }] });
  const above = evaluatePerceptualQa({
    model: thick,
    contexts: [{ id: "publication", width_mm: 254 }],
    rules: { "line_weight_pt.maximum": 1.5 },
  });
  assert.equal(categories(above).includes("line_weight_above_maximum"), true);

  const exactMaximum = makeModel({ elements: [{ name: "Box", kind: "shape", line_pt: 1.5 }] });
  assert.equal(
    categories(
      evaluatePerceptualQa({ model: exactMaximum, contexts: [{ id: "publication", width_mm: 254 }], rules: { "line_weight_pt.maximum": 1.5 } })
    ).includes("line_weight_above_maximum"),
    false,
    "exactly 1.5pt must satisfy an inclusive maximum"
  );

  const noTokens = evaluatePerceptualQa({ model: thin, contexts: [{ id: "publication", width_mm: 254 }], rules: {} });
  assert.equal(categories(noTokens).some((category) => category.startsWith("line_weight")), false);
});

await check("line weight scales with the delivery context", async () => {
  const model = makeModel({ elements: [{ name: "Box", kind: "shape", line_pt: 0.15 }] });
  const half = evaluatePerceptualQa({
    model,
    contexts: [{ id: "publication", width_mm: 127 }],
    rules: { "line_weight_pt.minimum": 0.1 },
  });
  assert.equal(categories(half).includes("line_weight_below_minimum"), true, "0.15pt at 50% delivery is 0.075pt");
  const full = evaluatePerceptualQa({
    model,
    contexts: [{ id: "publication", width_mm: 254 }],
    rules: { "line_weight_pt.minimum": 0.1 },
  });
  assert.equal(categories(full).includes("line_weight_below_minimum"), false);
});

await check("contrast flags low-ratio text and honors a configured threshold", async () => {
  const lowContrast = makeModel({ elements: [{ name: "Note", kind: "text", font_pt: 18, color: "#777777" }] });
  const flagged = evaluatePerceptualQa({ model: lowContrast, contexts: [], rules: {} });
  const finding = flagged.findings.find((entry) => entry.category === "contrast_below_minimum");
  assert.ok(finding);
  assert.equal(finding.objects[0], "Note");
  assert.match(finding.evidence, /white background assumed/);

  const passing = evaluatePerceptualQa({ model: lowContrast, contexts: [], rules: { "accessibility.minimum_contrast_ratio": 3 } });
  assert.equal(categories(passing).includes("contrast_below_minimum"), false);

  const onFill = makeModel({ elements: [{ name: "Note", kind: "text", font_pt: 18, color: "#FFFFFF", fill: "#FFFF00" }] });
  const fillFlagged = evaluatePerceptualQa({ model: onFill, contexts: [], rules: {} });
  const fillFinding = fillFlagged.findings.find((entry) => entry.category === "contrast_below_minimum");
  assert.ok(fillFinding);
  assert.match(fillFinding.evidence, /against #FFFF00/);
});

await check("threshold comparisons use raw values, not rounded ones", async () => {
  const model = makeModel({ elements: [{ name: "Edge", kind: "text", font_pt: 6.9996, color: "#222222" }] });
  const result = evaluatePerceptualQa({ model, contexts: [{ id: "publication", width_mm: 254 }], rules: { min_font_pt: 7 } });
  const finding = result.findings.find((entry) => entry.category === "font_size_below_minimum");
  assert.ok(finding, "6.9996pt must fail the 7pt minimum even though it rounds to 7.00");
  assert.match(finding.evidence, /renders at ~7pt/);

  const lineModel = makeModel({ elements: [{ name: "EdgeLine", kind: "shape", line_pt: 0.0996 }] });
  const lineResult = evaluatePerceptualQa({
    model: lineModel,
    contexts: [{ id: "publication", width_mm: 254 }],
    rules: { "line_weight_pt.minimum": 0.1 },
  });
  assert.equal(categories(lineResult).includes("line_weight_below_minimum"), true, "0.0996pt must fail the 0.1pt minimum even though it rounds to 0.1");

  const fontAbove = makeModel({ elements: [{ name: "Edge", kind: "text", font_pt: 7.0004, color: "#222222" }] });
  assert.equal(
    categories(evaluatePerceptualQa({ model: fontAbove, contexts: [{ id: "publication", width_mm: 254 }], rules: { min_font_pt: 7 } })).includes("font_size_below_minimum"),
    false,
    "7.0004pt must pass the 7pt minimum"
  );
  const fontExact = makeModel({ elements: [{ name: "Edge", kind: "text", font_pt: 7, color: "#222222" }] });
  assert.equal(
    categories(evaluatePerceptualQa({ model: fontExact, contexts: [{ id: "publication", width_mm: 254 }], rules: { min_font_pt: 7 } })).includes("font_size_below_minimum"),
    false,
    "exactly 7pt must satisfy an inclusive minimum"
  );
  const lineAbove = makeModel({ elements: [{ name: "EdgeLine", kind: "shape", line_pt: 0.1004 }] });
  assert.equal(
    categories(evaluatePerceptualQa({ model: lineAbove, contexts: [{ id: "publication", width_mm: 254 }], rules: { "line_weight_pt.minimum": 0.1 } })).includes("line_weight_below_minimum"),
    false,
    "0.1004pt must pass the 0.1pt minimum"
  );
});

await check("grayscale checks run only when the rule or option enables them", async () => {
  const model = makeModel({
    elements: [
      { name: "SeriesA", kind: "shape", fill: "#FF0000" },
      { name: "SeriesB", kind: "shape", fill: "#008000" },
    ],
  });
  const disabled = evaluatePerceptualQa({ model, contexts: [], rules: {} });
  assert.equal(categories(disabled).includes("grayscale_indistinguishable"), false);

  const enabled = evaluatePerceptualQa({ model, contexts: [], rules: { "accessibility.grayscale_distinguishable": true } });
  const finding = enabled.findings.find((entry) => entry.category === "grayscale_indistinguishable");
  assert.ok(finding);
  assert.deepEqual(finding.objects, ["SeriesA", "SeriesB"]);
  assert.equal(finding.rule_token, "accessibility.grayscale_distinguishable");

  const separated = makeModel({
    elements: [
      { name: "SeriesA", kind: "shape", fill: "#000000" },
      { name: "SeriesB", kind: "shape", fill: "#FFFFFF" },
    ],
  });
  const ok = evaluatePerceptualQa({ model: separated, contexts: [], rules: { "accessibility.grayscale_distinguishable": true } });
  assert.equal(categories(ok).includes("grayscale_indistinguishable"), false);
});

await check("thumbnail context flags figures whose largest text vanishes", async () => {
  const flagged = evaluatePerceptualQa({ model: makeModel(), contexts: [{ id: "thumbnail", width_px: 300 }], rules: {} });
  const finding = flagged.findings.find((entry) => entry.category === "thumbnail_illegible");
  assert.ok(finding);
  assert.deepEqual(finding.objects, ["Title"]);

  const larger = makeModel({ elements: [{ name: "Title", kind: "text", font_pt: 24, color: "#222222" }] });
  const passing = evaluatePerceptualQa({ model: larger, contexts: [{ id: "thumbnail", width_px: 300 }], rules: {} });
  assert.equal(categories(passing).includes("thumbnail_illegible"), false);

  const picturesOnly = makeModel({ elements: [{ name: "Micrograph", kind: "picture", pixel_width: 300, pixel_height: 225, placed_width_pt: 72, placed_height_pt: 54 }] });
  const noText = evaluatePerceptualQa({ model: picturesOnly, contexts: [{ id: "thumbnail", width_px: 300 }], rules: {} });
  assert.equal(categories(noText).includes("thumbnail_illegible"), false);
});

await check("thumbnail uses the largest text as the legibility proxy", async () => {
  const mixed = makeModel({
    elements: [
      { name: "Small", kind: "text", font_pt: 8, color: "#222222" },
      { name: "Big", kind: "text", font_pt: 24, color: "#222222" },
    ],
  });
  const passing = evaluatePerceptualQa({ model: mixed, contexts: [{ id: "thumbnail", width_px: 300 }], rules: {} });
  assert.equal(categories(passing).includes("thumbnail_illegible"), false);
  const smallOnly = makeModel({ elements: [{ name: "Small", kind: "text", font_pt: 8, color: "#222222" }] });
  const flagged = evaluatePerceptualQa({ model: smallOnly, contexts: [{ id: "thumbnail", width_px: 300 }], rules: {} });
  const finding = flagged.findings.find((entry) => entry.category === "thumbnail_illegible");
  assert.deepEqual(finding.objects, ["Small"]);

  const exact = makeModel({ elements: [{ name: "Edge", kind: "text", font_pt: 19.2, color: "#222222" }] });
  const exactResult = evaluatePerceptualQa({ model: exact, contexts: [{ id: "thumbnail", width_px: 300 }], rules: {} });
  assert.equal(categories(exactResult).includes("thumbnail_illegible"), false, "exactly 8px must satisfy the thumbnail floor");
});

await check("faithful recreation downgrades hard findings to warnings", async () => {
  const model = makeModel({ elements: [{ name: "Title", kind: "text", font_pt: 10, color: "#222222" }] });
  const faithful = evaluatePerceptualQa({
    model,
    contexts: [PUBLICATION_90MM],
    rules: { min_font_pt: 7 },
    policy: "faithful",
    options: { severity: "hard" },
  });
  assert.equal(faithful.counts.hard, 0);
  assert.equal(faithful.counts.warning, 1);
  assert.equal(faithful.findings[0].policy_downgraded, true);

  const publicationReady = evaluatePerceptualQa({
    model,
    contexts: [PUBLICATION_90MM],
    rules: { min_font_pt: 7 },
    policy: "publication-ready",
    options: { severity: "hard" },
  });
  assert.equal(publicationReady.counts.hard, 1);
  assert.equal(publicationReady.findings[0].policy_downgraded, undefined);
});

await check("contexts without a target size still report context-independent checks", async () => {
  const model = makeModel({ elements: [{ name: "Note", kind: "text", font_pt: 18, color: "#777777" }] });
  const result = evaluatePerceptualQa({ model, contexts: ["publication"], rules: { min_font_pt: 7 } });
  assert.equal(result.contexts[0].skipped_reason !== null, true);
  assert.equal(categories(result).includes("contrast_below_minimum"), true);
  assert.equal(categories(result).includes("font_size_below_minimum"), false);
});

await check("multiple contexts evaluate independently", async () => {
  const result = evaluatePerceptualQa({
    model: makeModel(),
    contexts: [PUBLICATION_90MM, { id: "screen", width_px: 1200 }],
    rules: { min_font_pt: 7 },
  });
  assert.equal(result.contexts.length, 2);
  const fontFindings = result.findings.filter((entry) => entry.category === "font_size_below_minimum");
  assert.equal(fontFindings.length, 1);
  assert.equal(fontFindings[0].context, "publication");
});

await check("malformed inputs degrade without throwing", async () => {
  const invalid = evaluatePerceptualQa({ model: null });
  assert.equal(typeof invalid.error, "string");
  assert.deepEqual(invalid.findings, []);

  const tolerant = evaluatePerceptualQa({
    model: makeModel({ elements: [null, 42, { name: "A", kind: "text", font_pt: 10, color: "#222222" }] }),
    contexts: [PUBLICATION_90MM],
    rules: { min_font_pt: 7 },
  });
  assert.equal(tolerant.findings.length, 1);
  assert.deepEqual(tolerant.findings[0].objects, ["A"]);
});

await check("max_findings caps output and reports truncation", async () => {
  const model = makeModel({
    elements: [
      { name: "Title", kind: "text", font_pt: 5, color: "#222222" },
      { name: "Box", kind: "shape", line_pt: 0.05 },
    ],
  });
  const result = evaluatePerceptualQa({
    model,
    contexts: [{ id: "publication", width_mm: 254 }],
    rules: { min_font_pt: 7, "line_weight_pt.minimum": 0.1 },
    options: { max_findings: 1 },
  });
  assert.equal(result.truncated, true);
  assert.equal(result.findings.length, 1);
});

console.log(`perceptual qa smoke: ${checks} checks passed.`);

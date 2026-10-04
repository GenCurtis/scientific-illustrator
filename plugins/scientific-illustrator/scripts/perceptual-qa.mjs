// Perceptual QA (P3a): deterministic checks evaluated at real delivery sizes.
//
// The roadmap acceptance line for P3 is: "compliance is not checked on the
// source canvas but at the real delivery size." This module implements that:
// it takes a backend-produced normalized model of an artifact plus resolved
// rule tokens (figure_rules_resolve) and one or more render contexts
// (design-plan render_contexts), then reports findings such as
// font_size_below_minimum, effective_dpi_below_minimum, line_weight_*,
// contrast_below_minimum, grayscale_indistinguishable, and thumbnail_illegible.
//
// Pure functions only: no filesystem, no backend, no network. Backend
// integration (python-pptx model extraction, audit merging) arrives in P3b;
// style deviation and the remaining accessibility checks in P3c.
//
// Normalized model (produced by backends):
// {
//   schema: "scientific-illustrator/perceptual-model@1",
//   canvas: { width_pt: 720, height_pt: 540 },
//   elements: [
//     { name, kind: "text", font_pt, font_name, color, fill, text_length, ... },
//     { name, kind: "picture", pixel_width, pixel_height, placed_width_pt, placed_height_pt },
//     { name, kind: "shape", line_pt, fill, line }
//   ]
// }

export const PERCEPTUAL_MODEL_SCHEMA_VERSION = "scientific-illustrator/perceptual-model@1";

const MM_PER_INCH = 25.4;
const PT_PER_INCH = 72;
const PX_PER_INCH = 96;
const MAX_GRAYSCALE_PAIRS = 10;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function ptFromMm(mm) {
  return (Number(mm) * PT_PER_INCH) / MM_PER_INCH;
}

export function ptFromPx(px) {
  return (Number(px) * PT_PER_INCH) / PX_PER_INCH;
}

export function meetsComparison(actual, threshold, comparison = "greater-than-or-equal") {
  if (!Number.isFinite(actual) || !Number.isFinite(threshold)) return false;
  if (comparison === "greater-than") return actual > threshold;
  return actual >= threshold;
}

function parseHexColor(value) {
  if (typeof value !== "string") return null;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((channel) => channel + channel)
      .join("");
  }
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function channelLuminance(channel) {
  const scaled = channel / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const rgb = parseHexColor(hex);
  if (!rgb) return null;
  return 0.2126 * channelLuminance(rgb.r) + 0.7152 * channelLuminance(rgb.g) + 0.0722 * channelLuminance(rgb.b);
}

export function contrastRatio(first, second) {
  const luminanceA = relativeLuminance(first);
  const luminanceB = relativeLuminance(second);
  if (luminanceA === null || luminanceB === null) return null;
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

export function grayscaleLuminance(hex) {
  const rgb = parseHexColor(hex);
  if (!rgb) return null;
  return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
}

function normalizeHex(value) {
  const match = typeof value === "string" ? /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim()) : null;
  if (!match) return null;
  let hex = match[1].toLowerCase();
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((channel) => channel + channel)
      .join("");
  }
  return `#${hex}`;
}

function collectHexColors(value, out, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return out;
  if (typeof value === "string") {
    const hex = normalizeHex(value);
    if (hex) out.add(hex);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectHexColors(item, out, depth + 1);
    return out;
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) collectHexColors(item, out, depth + 1);
  }
  return out;
}

// Rules arrive either as resolved entries ({ value, source, ... }) or as raw
// token values; both shapes are accepted so tests and callers stay simple.
export function readRuleToken(rules, token) {
  if (!isPlainObject(rules) || typeof token !== "string") return undefined;
  if (!Object.prototype.hasOwnProperty.call(rules, token)) return undefined;
  const entry = rules[token];
  if (isPlainObject(entry) && Object.prototype.hasOwnProperty.call(entry, "value")) return entry.value;
  return entry;
}

// A context entry is either a bare id string or {id, width_mm | width_px}.
// Membership in KNOWN_RENDER_CONTEXTS is enforced by validatePlan; this
// function only normalizes what it is given. Invalid entries (empty id,
// invalid or mutually exclusive widths) return null so callers can report
// them instead of silently misreading one width as the other.
export function normalizeRenderContext(entry) {
  if (typeof entry === "string") {
    const id = entry.trim();
    if (!id) return null;
    return { id, unit: null, target_width_pt: null };
  }
  if (!isPlainObject(entry) || !isNonEmptyString(entry.id)) return null;
  const id = entry.id.trim();
  const hasMm = Object.prototype.hasOwnProperty.call(entry, "width_mm") && entry.width_mm !== undefined;
  const hasPx = Object.prototype.hasOwnProperty.call(entry, "width_px") && entry.width_px !== undefined;
  if (!hasMm && !hasPx) return { id, unit: null, target_width_pt: null };
  if (hasMm && hasPx) return null;
  const raw = hasMm ? entry.width_mm : entry.width_px;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
  return hasMm ? { id, unit: "mm", target_width_pt: ptFromMm(raw) } : { id, unit: "px", target_width_pt: ptFromPx(raw) };
}

function normalizeModel(model) {
  if (!isPlainObject(model) || !isPlainObject(model.canvas)) {
    return { error: "model must be an object with a canvas block." };
  }
  const widthPt = Number(model.canvas.width_pt);
  if (!Number.isFinite(widthPt) || widthPt <= 0) {
    return { error: "model.canvas.width_pt must be a positive number." };
  }
  const heightPt = Number(model.canvas.height_pt);
  return {
    schema: isNonEmptyString(model.schema) ? model.schema : null,
    canvas: { width_pt: widthPt, height_pt: Number.isFinite(heightPt) ? heightPt : null },
    elements: Array.isArray(model.elements) ? model.elements.filter(isPlainObject) : [],
  };
}

function makeFinding(category, objects, details) {
  const { severity, context, rule_token, evidence, correction, acceptance, ...extra } = details;
  return {
    category,
    severity,
    objects: objects.map((name) => String(name)),
    ...(context ? { context } : {}),
    ...(rule_token ? { rule_token } : {}),
    ...extra,
    evidence,
    correction,
    acceptance,
  };
}

function checkFontScale({ normalized, context, scale, rules, findings, severity }) {
  const publisherToken = "fonts.full_size_text_min_pt";
  const publisherMin = readRuleToken(rules, publisherToken);
  const profileMin = readRuleToken(rules, "min_font_pt");
  const usePublisher = typeof publisherMin === "number" && Number.isFinite(publisherMin) && publisherMin > 0;
  const threshold = usePublisher ? publisherMin : typeof profileMin === "number" && Number.isFinite(profileMin) && profileMin > 0 ? profileMin : null;
  if (threshold === null) return;
  const token = usePublisher ? publisherToken : "min_font_pt";
  for (const element of normalized.elements) {
    if (element.kind !== "text") continue;
    const fontPt = Number(element.font_pt);
    if (!Number.isFinite(fontPt) || fontPt <= 0) continue;
    const rawEffective = fontPt * scale;
    if (rawEffective < threshold) {
      const effective = round(rawEffective, 2);
      findings.push(
        makeFinding("font_size_below_minimum", [element.name ?? "unnamed"], {
          severity,
          context: context.id,
          rule_token: token,
          evidence: `"${element.name ?? "unnamed"}" renders at ~${effective}pt in the "${context.id}" context (minimum ${threshold}pt).`,
          correction: "Increase the font size, or enlarge the figure at its delivery size, so the text stays legible.",
          acceptance: `Effective font size is at least ${threshold}pt in the "${context.id}" context.`,
        })
      );
    }
  }
}

function checkEffectiveDpi({ normalized, context, scale, rules, opts, findings, severity }) {
  const rasterClass = isNonEmptyString(opts.raster_class) ? opts.raster_class.trim() : null;
  let threshold = null;
  let comparison = "greater-than-or-equal";
  let token = null;
  if (rasterClass) {
    const classMin = readRuleToken(rules, `raster.${rasterClass}.minimum_dpi`);
    if (typeof classMin === "number" && Number.isFinite(classMin) && classMin > 0) {
      threshold = classMin;
      token = `raster.${rasterClass}.minimum_dpi`;
      const classComparison = readRuleToken(rules, `raster.${rasterClass}.comparison`);
      if (isNonEmptyString(classComparison)) comparison = classComparison;
    }
  }
  if (threshold === null) {
    const profileMin = readRuleToken(rules, "min_raster_dpi");
    if (typeof profileMin === "number" && Number.isFinite(profileMin) && profileMin > 0) {
      threshold = profileMin;
      token = "min_raster_dpi";
    }
  }
  if (threshold === null) return;
  for (const element of normalized.elements) {
    if (element.kind !== "picture") continue;
    const pixelWidth = Number(element.pixel_width);
    const pixelHeight = Number(element.pixel_height);
    const placedWidthPt = Number(element.placed_width_pt);
    const placedHeightPt = Number(element.placed_height_pt);
    if (![pixelWidth, pixelHeight, placedWidthPt, placedHeightPt].every((value) => Number.isFinite(value) && value > 0)) continue;
    // The model records source-canvas placement; the delivery context scales
    // it, so the effective resolution must be evaluated at delivery size.
    const deliveredWidthPt = placedWidthPt * scale;
    const deliveredHeightPt = placedHeightPt * scale;
    const dpi = Math.min(pixelWidth / (deliveredWidthPt / PT_PER_INCH), pixelHeight / (deliveredHeightPt / PT_PER_INCH));
    if (!meetsComparison(dpi, threshold, comparison)) {
      findings.push(
        makeFinding("effective_dpi_below_minimum", [element.name ?? "unnamed"], {
          severity,
          context: context.id,
          rule_token: token,
          evidence: `"${element.name ?? "unnamed"}" has an effective resolution of ~${Math.round(dpi)} dpi at delivery size (requires ${comparison === "greater-than" ? ">" : ">="} ${threshold} dpi).`,
          correction: "Use a higher-resolution source image, or place the picture smaller at delivery size.",
          acceptance: `Effective resolution satisfies "${comparison} ${threshold}" dpi in the "${context.id}" context.`,
        })
      );
    }
  }
}

function checkLineWeight({ normalized, context, scale, rules, findings, severity }) {
  const minimum = readRuleToken(rules, "line_weight_pt.minimum");
  const maximum = readRuleToken(rules, "line_weight_pt.maximum");
  const hasMinimum = typeof minimum === "number" && Number.isFinite(minimum) && minimum > 0;
  const hasMaximum = typeof maximum === "number" && Number.isFinite(maximum) && maximum > 0;
  if (!hasMinimum && !hasMaximum) return;
  for (const element of normalized.elements) {
    if (element.kind !== "shape" && element.kind !== "line") continue;
    const linePt = Number(element.line_pt);
    if (!Number.isFinite(linePt) || linePt <= 0) continue;
    const rawEffective = linePt * scale;
    if (hasMinimum && rawEffective < minimum) {
      const effective = round(rawEffective, 3);
      findings.push(
        makeFinding("line_weight_below_minimum", [element.name ?? "unnamed"], {
          severity,
          context: context.id,
          rule_token: "line_weight_pt.minimum",
          evidence: `"${element.name ?? "unnamed"}" strokes at ~${effective}pt in the "${context.id}" context (minimum ${minimum}pt); the line may disappear in print.`,
          correction: "Increase the stroke width, or enlarge the figure at its delivery size.",
          acceptance: `Effective line weight is at least ${minimum}pt in the "${context.id}" context.`,
        })
      );
    }
    if (hasMaximum && rawEffective > maximum) {
      const effective = round(rawEffective, 3);
      findings.push(
        makeFinding("line_weight_above_maximum", [element.name ?? "unnamed"], {
          severity,
          context: context.id,
          rule_token: "line_weight_pt.maximum",
          evidence: `"${element.name ?? "unnamed"}" strokes at ~${effective}pt in the "${context.id}" context (maximum ${maximum}pt).`,
          correction: "Reduce the stroke width so the figure matches the publication's line weight range.",
          acceptance: `Effective line weight is at most ${maximum}pt in the "${context.id}" context.`,
        })
      );
    }
  }
}

function checkContrast({ normalized, rules, findings, severity }) {
  const configured = readRuleToken(rules, "accessibility.minimum_contrast_ratio");
  const useConfigured = typeof configured === "number" && Number.isFinite(configured) && configured > 0;
  const threshold = useConfigured ? configured : 4.5;
  for (const element of normalized.elements) {
    if (element.kind !== "text") continue;
    const textColor = parseHexColor(element.color);
    if (!textColor) continue;
    const hasFill = parseHexColor(element.fill) !== null;
    const background = hasFill ? element.fill : "#FFFFFF";
    const ratio = contrastRatio(element.color, background);
    if (ratio === null) continue;
    if (ratio < threshold) {
      findings.push(
        makeFinding("contrast_below_minimum", [element.name ?? "unnamed"], {
          severity,
          ...(useConfigured ? { rule_token: "accessibility.minimum_contrast_ratio" } : {}),
          evidence: `"${element.name ?? "unnamed"}" has a contrast ratio of ${round(ratio, 2)}:1 against ${background}${hasFill ? "" : " (white background assumed; the shape has no solid fill)"} (minimum ${threshold}:1).`,
          correction: "Darken the text, lighten the background, or add a solid backing shape.",
          acceptance: `Contrast ratio is at least ${threshold}:1.`,
        })
      );
    }
  }
}

function checkGrayscale({ normalized, rules, opts, findings, severity }) {
  const enabledByRule = readRuleToken(rules, "accessibility.grayscale_distinguishable") === true;
  const enabledByOption = opts.grayscale_check === true;
  if (!enabledByRule && !enabledByOption) return;
  const delta = typeof opts.grayscale_min_luminance_delta === "number" && Number.isFinite(opts.grayscale_min_luminance_delta) && opts.grayscale_min_luminance_delta >= 0
    ? opts.grayscale_min_luminance_delta
    : 12;
  const colors = new Map();
  for (const element of normalized.elements) {
    if (element.kind !== "shape" && element.kind !== "text") continue;
    const luminance = grayscaleLuminance(element.fill);
    if (luminance === null) continue;
    const key = String(element.fill).trim().toLowerCase();
    if (!colors.has(key)) colors.set(key, { luminance, names: [] });
    colors.get(key).names.push(String(element.name ?? "unnamed"));
  }
  const entries = [...colors.entries()];
  let pairs = 0;
  for (let first = 0; first < entries.length && pairs < MAX_GRAYSCALE_PAIRS; first += 1) {
    for (let second = first + 1; second < entries.length && pairs < MAX_GRAYSCALE_PAIRS; second += 1) {
      const [hexA, entryA] = entries[first];
      const [hexB, entryB] = entries[second];
      const separation = Math.abs(entryA.luminance - entryB.luminance);
      if (separation < delta) {
        pairs += 1;
        findings.push(
          makeFinding("grayscale_indistinguishable", [...entryA.names.slice(0, 3), ...entryB.names.slice(0, 3)], {
            severity,
            rule_token: "accessibility.grayscale_distinguishable",
            evidence: `Fills ${hexA} and ${hexB} differ by only ${round(separation, 1)} luminance levels; they may be indistinguishable in grayscale print.`,
            correction: "Increase the luminance separation, or add a non-color encoding (pattern, marker, or dash style).",
            acceptance: "Distinct category fills remain distinguishable when converted to grayscale.",
          })
        );
      }
    }
  }
}

function checkThumbnail({ normalized, context, scale, opts, findings, severity }) {
  const minPx = typeof opts.thumbnail_min_text_px === "number" && Number.isFinite(opts.thumbnail_min_text_px) && opts.thumbnail_min_text_px > 0
    ? opts.thumbnail_min_text_px
    : 8;
  let largest = null;
  for (const element of normalized.elements) {
    if (element.kind !== "text") continue;
    const fontPt = Number(element.font_pt);
    if (!Number.isFinite(fontPt) || fontPt <= 0) continue;
    const px = fontPt * scale * (PX_PER_INCH / PT_PER_INCH);
    if (!largest || px > largest.px) largest = { name: String(element.name ?? "unnamed"), px };
  }
  if (!largest) return;
  if (largest.px < minPx) {
    findings.push(
      makeFinding("thumbnail_illegible", [largest.name], {
        severity,
        context: context.id,
        evidence: `The largest text ("${largest.name}") renders at ~${round(largest.px, 1)}px in the "${context.id}" context (minimum ${minPx}px); the figure will not read at thumbnail size.`,
        correction: "Enlarge key text, or simplify the figure so its main structure survives thumbnail scale.",
        acceptance: `The largest text stays at or above ${minPx}px in the "${context.id}" context.`,
      })
    );
  }
}

function checkStyleDeviation({ normalized, style, findings }) {
  if (!isPlainObject(style)) return;
  const styleSeverity = style.enforce === "hard" ? "hard" : "warning";
  const declaredFamilies = [];
  if (isNonEmptyString(style.fonts?.family)) declaredFamilies.push(style.fonts.family.trim());
  if (Array.isArray(style.fonts?.fallbacks)) {
    for (const item of style.fonts.fallbacks) {
      if (isNonEmptyString(item)) declaredFamilies.push(item.trim());
    }
  }
  const familiesLower = declaredFamilies.map((item) => item.toLowerCase());
  const declaredStroke =
    typeof style.lines?.stroke_pt === "number" && Number.isFinite(style.lines.stroke_pt) && style.lines.stroke_pt > 0
      ? style.lines.stroke_pt
      : null;
  const declaredColors = collectHexColors(style.palette, new Set());
  collectHexColors(style.semantic_styles, declaredColors);
  const colorWhitelist = new Set(["#ffffff", "#000000"]);
  const reportedColors = new Set();
  for (const element of normalized.elements) {
    const name = String(element.name ?? "unnamed");
    if (element.kind === "text" && declaredFamilies.length > 0 && isNonEmptyString(element.font_name)) {
      const actual = element.font_name.trim();
      if (!familiesLower.includes(actual.toLowerCase())) {
        findings.push(
          makeFinding("style_deviation", [name], {
            severity: styleSeverity,
            token: "fonts.family",
            expected: declaredFamilies[0],
            actual,
            evidence: `"${name}" uses font "${actual}" while the manuscript style declares ${declaredFamilies.join(", ")}.`,
            correction: "Switch to a declared style font, or record a brief style_override with a reason.",
            acceptance: `Fonts match the manuscript style (${declaredFamilies.join(", ")}).`,
          })
        );
      }
    }
    if ((element.kind === "shape" || element.kind === "line") && declaredStroke !== null) {
      const linePt = Number(element.line_pt);
      if (Number.isFinite(linePt) && linePt > 0 && Math.abs(linePt - declaredStroke) > 0.01) {
        findings.push(
          makeFinding("style_deviation", [name], {
            severity: styleSeverity,
            token: "lines.stroke_pt",
            expected: declaredStroke,
            actual: round(linePt, 3),
            evidence: `"${name}" strokes at ${round(linePt, 3)}pt while the manuscript style declares ${declaredStroke}pt.`,
            correction: "Match the declared stroke width, or record a brief style_override with a reason.",
            acceptance: `Stroke widths match the manuscript style (${declaredStroke}pt).`,
          })
        );
      }
    }
    if (declaredColors.size > 0) {
      for (const color of [element.fill, element.color, element.line]) {
        const hex = normalizeHex(color);
        if (!hex || colorWhitelist.has(hex) || declaredColors.has(hex) || reportedColors.has(hex)) continue;
        reportedColors.add(hex);
        findings.push(
          makeFinding("style_deviation", [name], {
            severity: styleSeverity,
            token: "palette",
            expected: "declared palette",
            actual: hex,
            evidence: `"${name}" uses ${hex}, which is not part of the manuscript palette.`,
            correction: "Use a declared palette color, or record a brief style_override with a reason.",
            acceptance: "Figure colors stay inside the declared manuscript palette.",
          })
        );
      }
    }
  }
}

function checkColorBlindRisk({ normalized, rules, opts, findings, severity }) {
  const enabledByRule = readRuleToken(rules, "accessibility.non_color_encoding") === true;
  const enabledByOption = opts.color_blind_check === true;
  if (!enabledByRule && !enabledByOption) return;
  const threshold =
    typeof opts.color_blind_min_luminance_delta === "number" &&
    Number.isFinite(opts.color_blind_min_luminance_delta) &&
    opts.color_blind_min_luminance_delta >= 0
      ? opts.color_blind_min_luminance_delta
      : 40;
  const entries = new Map();
  for (const element of normalized.elements) {
    if (element.kind !== "shape" && element.kind !== "text") continue;
    const rgb = parseHexColor(element.fill);
    if (!rgb) continue;
    const key = normalizeHex(element.fill);
    if (!entries.has(key)) entries.set(key, { rgb, luminance: grayscaleLuminance(element.fill), names: [] });
    entries.get(key).names.push(String(element.name ?? "unnamed"));
  }
  const list = [...entries.entries()];
  let pairs = 0;
  for (let first = 0; first < list.length && pairs < MAX_GRAYSCALE_PAIRS; first += 1) {
    for (let second = first + 1; second < list.length && pairs < MAX_GRAYSCALE_PAIRS; second += 1) {
      const [hexA, entryA] = list[first];
      const [hexB, entryB] = list[second];
      const redGreenPair =
        (entryA.rgb.r > entryA.rgb.g && entryB.rgb.g > entryB.rgb.r) || (entryB.rgb.r > entryB.rgb.g && entryA.rgb.g > entryA.rgb.r);
      if (!redGreenPair) continue;
      if (Math.abs(entryA.luminance - entryB.luminance) >= threshold) continue;
      pairs += 1;
      findings.push(
        makeFinding("color_blind_risk", [...entryA.names.slice(0, 3), ...entryB.names.slice(0, 3)], {
          severity,
          rule_token: "accessibility.non_color_encoding",
          evidence: `Fills ${hexA} and ${hexB} rely on a red/green distinction with similar luminance; they may be indistinguishable for red-green color vision deficiency.`,
          correction: "Add a non-color encoding (shape, pattern, or dash style), or separate the luminance.",
          acceptance: "Red/green distinctions carry a non-color encoding or sufficient luminance separation.",
        })
      );
    }
  }
}

function applyPolicy(findings, policy) {
  if (policy !== "faithful") return findings;
  return findings.map((finding) =>
    finding.severity === "hard" ? { ...finding, severity: "warning", policy_downgraded: true } : finding
  );
}

function countSeverities(findings) {
  const counts = { hard: 0, warning: 0 };
  for (const finding of findings) {
    if (finding.severity === "hard") counts.hard += 1;
    else counts.warning += 1;
  }
  return counts;
}

export function evaluatePerceptualQa({ model, contexts = [], rules = {}, style = null, policy = "unspecified", options = {} } = {}) {
  const normalized = normalizeModel(model);
  const base = { model_schema: null, policy, contexts: [], invalid_contexts: [], findings: [], counts: { hard: 0, warning: 0 }, truncated: false };
  if (normalized.error) return { ...base, error: normalized.error };
  const opts = isPlainObject(options) ? options : {};
  const severity = opts.severity === "hard" ? "hard" : "warning";
  const maxFindings = Number.isInteger(opts.max_findings) && opts.max_findings > 0 ? opts.max_findings : 300;
  const findings = [];
  const contextResults = [];
  const invalidContexts = [];
  if (contexts !== undefined && contexts !== null && !Array.isArray(contexts)) {
    invalidContexts.push({ index: null, reason: "contexts must be an array when provided." });
  }
  for (const [index, entry] of (Array.isArray(contexts) ? contexts : []).entries()) {
    const context = normalizeRenderContext(entry);
    if (!context) {
      invalidContexts.push({
        index,
        reason: "invalid render context entry: the id must be a non-empty string and width_mm/width_px must be positive finite numbers that are mutually exclusive.",
      });
      continue;
    }
    const scale = context.target_width_pt ? context.target_width_pt / normalized.canvas.width_pt : null;
    const evaluated = [];
    if (scale) {
      if (context.id === "thumbnail") {
        checkThumbnail({ normalized, context, scale, opts, findings, severity });
        evaluated.push("thumbnail_illegible");
      } else {
        checkFontScale({ normalized, context, scale, rules, findings, severity });
        evaluated.push("font_size_below_minimum");
      }
      if (context.unit === "mm") {
        checkEffectiveDpi({ normalized, context, scale, rules, opts, findings, severity });
        checkLineWeight({ normalized, context, scale, rules, findings, severity });
        evaluated.push("effective_dpi_below_minimum", "line_weight");
      }
    }
    contextResults.push({
      id: context.id,
      unit: context.unit,
      target_width_pt: context.target_width_pt,
      scale,
      evaluated,
      skipped_reason: scale ? null : "context declares no target size; only context-independent checks apply",
    });
  }
  checkContrast({ normalized, rules, findings, severity });
  checkGrayscale({ normalized, rules, opts, findings, severity });
  checkStyleDeviation({ normalized, style, findings });
  checkColorBlindRisk({ normalized, rules, opts, findings, severity });
  const capped = findings.slice(0, maxFindings);
  const finalFindings = applyPolicy(capped, policy);
  return {
    model_schema: normalized.schema,
    policy,
    contexts: contextResults,
    invalid_contexts: invalidContexts,
    findings: finalFindings,
    truncated: findings.length > capped.length,
    counts: countSeverities(finalFindings),
  };
}

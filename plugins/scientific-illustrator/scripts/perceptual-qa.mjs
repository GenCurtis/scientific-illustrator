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

function makeFinding(category, objects, { severity, context, rule_token, evidence, correction, acceptance }) {
  return {
    category,
    severity,
    objects: objects.map((name) => String(name)),
    ...(context ? { context } : {}),
    ...(rule_token ? { rule_token } : {}),
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

export function evaluatePerceptualQa({ model, contexts = [], rules = {}, policy = "unspecified", options = {} } = {}) {
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

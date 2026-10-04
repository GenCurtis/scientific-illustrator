// Deck consistency audit glue (P4c): compare a backend-produced cross-slide
// summary (per-slide fonts, colors, max font size) with the deck truth
// document (deck@1) and the shared style contract, then merge the resulting
// findings into an audit result before ledger attribution runs.
//
// Degrades to { applied: false, reason } on any failure; never throws. All
// findings are advisory by default; a style with enforce="hard" upgrades the
// font/palette outlier findings, while truth checks (slide count, missing
// slide briefs) stay warnings.
import { promises as fs } from "node:fs";
import { readDeck, slideBriefPath } from "./figure-deck.mjs";
import { readFigureStyle } from "./figure-style.mjs";
import { collectHexColors, normalizeHex } from "./perceptual-qa.mjs";

const NEUTRAL_COLORS = new Set(["#ffffff", "#000000"]);

function trimmedString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function styleFontSet(style) {
  const fonts = style?.fonts;
  if (!fonts || typeof fonts !== "object") return null;
  const families = [];
  if (typeof fonts.family === "string" && fonts.family.trim()) families.push(fonts.family.trim());
  if (Array.isArray(fonts.fallbacks)) {
    for (const fallback of fonts.fallbacks) {
      if (typeof fallback === "string" && fallback.trim()) families.push(fallback.trim());
    }
  }
  if (!families.length) return null;
  return new Set(families.map((family) => family.toLowerCase()));
}

function stylePaletteSet(style) {
  if (!style || typeof style !== "object") return null;
  const colors = new Set(NEUTRAL_COLORS);
  let declared = false;
  for (const key of ["palette", "semantic_styles"]) {
    if (style[key] !== undefined) {
      collectHexColors(style[key], colors);
      declared = true;
    }
  }
  return declared ? colors : null;
}

function outlierSeverity(style) {
  return style?.enforce === "hard" ? "hard" : "warning";
}

export async function applyDeckConsistency(auditValue, { artifactPath = null, deckPath = null } = {}) {
  if (!auditValue || typeof auditValue !== "object") {
    return { applied: false, reason: "the audit result is not an object." };
  }
  const slides = Array.isArray(auditValue.slides) ? auditValue.slides : null;
  if (!slides) {
    const skipped = { applied: false, reason: "the backend did not provide per-slide summaries." };
    auditValue.deck_consistency = skipped;
    return skipped;
  }
  const warnings = [];
  try {
    let deck = null;
    let deckApplied = null;
    if (trimmedString(artifactPath) || trimmedString(deckPath)) {
      try {
        const read = await readDeck({ artifactPath, deckPath });
        if (read.exists) {
          deck = read.document;
          deckApplied = { path: read.resolved_path, revision: read.revision };
        }
      } catch (error) {
        warnings.push(`the deck truth could not be read: ${error.message}`);
      }
    }
    let style = null;
    let styleApplied = null;
    const styleId = trimmedString(deck?.style_id);
    const styleAnchor = trimmedString(artifactPath) || deckApplied?.path || null;
    if (styleAnchor) {
      try {
        const read = await readFigureStyle({ artifactPath: styleAnchor, styleId });
        if (read.exists) {
          style = read.document;
          styleApplied = { path: read.resolved_path, revision: read.revision };
        }
      } catch (error) {
        warnings.push(`the figure style could not be read: ${error.message}`);
      }
    }

    const findings = [];
    const actualSlideCount = Number.isInteger(auditValue.slide_count) ? auditValue.slide_count : slides.length;
    if (deck && Array.isArray(deck.slides) && deck.slides.length !== actualSlideCount) {
      findings.push({
        category: "deck_slide_count_mismatch",
        severity: "warning",
        objects: ["deck"],
        evidence: `The deck truth lists ${deck.slides.length} slides but the presentation contains ${actualSlideCount}.`,
        correction: "Update the deck document (deck_write) or add the missing slides so truth and artifact agree.",
        acceptance: "Deck slide list and presentation slide count match.",
      });
    }

    const fontsBySlide = new Map();
    for (const slide of slides) {
      const index = Number.isInteger(slide?.index) ? slide.index : null;
      for (const font of Array.isArray(slide?.fonts) ? slide.fonts : []) {
        if (typeof font !== "string" || !font.trim()) continue;
        const key = font.trim().toLowerCase();
        if (!fontsBySlide.has(key)) fontsBySlide.set(key, { display: font.trim(), slides: [] });
        if (index !== null) fontsBySlide.get(key).slides.push(index);
      }
    }
    const allowedFonts = styleFontSet(style);
    if (allowedFonts) {
      for (const [key, info] of fontsBySlide) {
        if (allowedFonts.has(key)) continue;
        findings.push({
          category: "deck_font_outlier",
          severity: outlierSeverity(style),
          objects: [info.display],
          evidence: `Font "${info.display}" is not declared in the style contract (used on slides ${info.slides.join(", ")}).`,
          correction: "Use a declared font family or add the family to the style contract.",
          acceptance: "Every deck font family is declared in the style contract.",
        });
      }
    }

    const palette = stylePaletteSet(style);
    if (palette) {
      const colorsBySlide = new Map();
      for (const slide of slides) {
        const index = Number.isInteger(slide?.index) ? slide.index : null;
        for (const color of Array.isArray(slide?.colors) ? slide.colors : []) {
          const hex = normalizeHex(color);
          if (!hex) continue;
          if (!colorsBySlide.has(hex)) colorsBySlide.set(hex, []);
          if (index !== null) colorsBySlide.get(hex).push(index);
        }
      }
      for (const [hex, indexes] of colorsBySlide) {
        if (palette.has(hex)) continue;
        findings.push({
          category: "deck_palette_outlier",
          severity: outlierSeverity(style),
          objects: [hex],
          evidence: `Color ${hex} is not declared in the style contract (used on slides ${indexes.join(", ")}).`,
          correction: "Use a declared palette color or add the color to the style contract.",
          acceptance: "Every deck color is declared in the style contract.",
        });
      }
    }

    if (deck && deckApplied) {
      for (const slide of Array.isArray(deck.slides) ? deck.slides : []) {
        if (typeof slide?.brief !== "string" || !slide.brief.trim()) continue;
        let briefFile;
        try {
          briefFile = slideBriefPath(deck, deckApplied.path, slide);
        } catch {
          continue;
        }
        try {
          await fs.access(briefFile);
        } catch {
          findings.push({
            category: "deck_slide_brief_missing",
            severity: "warning",
            objects: [typeof slide.id === "string" && slide.id.trim() ? slide.id : "slide"],
            evidence: `Slide "${slide.id}" references brief ${slide.brief} but the file does not exist.`,
            correction: "Write the slide brief (figure_brief_write with the brief path) or remove the stale reference.",
            acceptance: "Every referenced slide brief exists.",
          });
        }
      }
    }

    const mapped = findings.map(({ objects, evidence, ...rest }) => ({
      ...rest,
      shape_name: objects[0] ?? "deck",
      message: evidence,
    }));
    if (mapped.length > 0) {
      auditValue.findings = Array.isArray(auditValue.findings) ? [...auditValue.findings, ...mapped] : mapped;
      const hard = auditValue.findings.filter((finding) => finding?.severity === "hard").length;
      auditValue.hard_failure_count = hard;
      auditValue.warning_count = auditValue.findings.length - hard;
      auditValue.passed_deterministic_gate = hard === 0;
    }
    const summary = {
      applied: true,
      deck_applied: deckApplied,
      style_applied: styleApplied,
      slide_count: actualSlideCount,
      findings_added: mapped.length,
      warnings,
    };
    auditValue.deck_consistency = summary;
    return summary;
  } catch (error) {
    const summary = { applied: false, reason: `deck consistency evaluation failed: ${error.message}` };
    auditValue.deck_consistency = summary;
    return summary;
  }
}

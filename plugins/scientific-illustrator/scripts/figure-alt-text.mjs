// P4: deterministic first-draft alt-text generation.
//
// The draft is composed from the brief's claims and inventory plus the design
// plan (archetype, reading order, primary claims). It never invents content
// that is absent from the truth documents: missing sections are reported as
// warnings instead, and the tool output records exactly which truth entries
// were used so a human can review the draft against the sources.
//
// The draft is a starting point for `accessibility.alt_text` in the brief (or
// a manuscript `\Description{}`); it is not an authoritative description.

export const ALT_TEXT_SCHEMA_VERSION = "scientific-illustrator/alt-text@1";

const KIND_PHRASES = {
  "data-plot": "data plot",
  "multi-panel-data": "multi-panel data figure",
  "experimental-workflow": "experimental workflow",
  mechanism: "mechanism diagram",
  process: "process diagram",
  "system-architecture": "system architecture diagram",
  "image-panel": "image panel",
  spatial: "spatial figure",
  network: "network diagram",
  "mixed-composite": "composite figure",
};

const DEFAULT_MAX_CLAIMS = 3;
const DEFAULT_MAX_LABELS = 6;
const DEFAULT_MAX_PANELS = 8;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function positiveIntegerOr(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function trimTerminalPunctuation(text) {
  return text.trim().replace(/[.。!?！？;；]+$/u, "");
}

// Chooses a/an from the first letter so drafts read correctly for
// vowel-initial phrases ("an experimental workflow", "an iterative layout").
function withArticle(phrase) {
  return `${/^[aeiou]/i.test(phrase) ? "an" : "a"} ${phrase}`;
}

// A claim is descriptive only when it still carries letters, digits, or CJK
// characters after trimming. Claims made of pure punctuation (including
// ellipses and dashes outside the trim set) must not produce "It shows ."
// sentences.
function hasDescriptiveText(statement) {
  return /[\p{L}\p{N}]/u.test(trimTerminalPunctuation(statement));
}

export function generateAltText({ brief, plan = null, options = {} } = {}) {
  if (!isPlainObject(brief)) {
    throw new Error("brief must be a brief document object.");
  }
  const opts = isPlainObject(options) ? options : {};
  const maxClaims = positiveIntegerOr(opts.max_claims, DEFAULT_MAX_CLAIMS);
  const maxLabels = positiveIntegerOr(opts.max_labels, DEFAULT_MAX_LABELS);
  const maxPanels = positiveIntegerOr(opts.max_panels, DEFAULT_MAX_PANELS);

  const warnings = [];
  const sentences = [];

  const kind = isNonEmptyString(brief.figure_kind) ? brief.figure_kind.trim() : null;
  const kindPhrase = kind ? KIND_PHRASES[kind] || `${kind.replace(/-/g, " ")} figure` : "scientific figure";
  const planUsed = isPlainObject(plan);
  const archetype = planUsed && isNonEmptyString(plan.archetype) ? plan.archetype.trim() : null;
  const opening = `${withArticle(kindPhrase)}${archetype ? ` organized as ${withArticle(`${archetype} layout`)}` : ""}.`;
  sentences.push(opening.charAt(0).toUpperCase() + opening.slice(1));

  const claimsById = new Map();
  if (Array.isArray(brief.claims)) {
    for (const claim of brief.claims) {
      if (isPlainObject(claim) && isNonEmptyString(claim.id) && isNonEmptyString(claim.statement)) {
        claimsById.set(claim.id.trim(), claim);
      }
    }
  }
  const orderedClaims = [];
  if (planUsed && Array.isArray(plan.primary_claims)) {
    for (const id of plan.primary_claims) {
      const claim = isNonEmptyString(id) ? claimsById.get(id.trim()) : undefined;
      if (claim && !orderedClaims.includes(claim)) orderedClaims.push(claim);
    }
  }
  const remaining = [...claimsById.values()]
    .filter((claim) => !orderedClaims.includes(claim))
    .map((claim, index) => ({ claim, index }))
    .sort((left, right) => (left.claim.priority ?? 99) - (right.claim.priority ?? 99) || left.index - right.index)
    .map((entry) => entry.claim);
  for (const claim of remaining) orderedClaims.push(claim);

  const claimsUsed = orderedClaims.slice(0, maxClaims);
  const describedClaims = claimsUsed.filter((claim) => hasDescriptiveText(claim.statement));
  if (describedClaims.length > 0) {
    sentences.push(`It shows ${describedClaims.map((claim) => trimTerminalPunctuation(claim.statement)).join("; ")}.`);
  }
  if (describedClaims.length < claimsUsed.length) {
    warnings.push(`${claimsUsed.length - describedClaims.length} claim(s) had no descriptive text after trimming and were omitted from the draft.`);
  }
  if (claimsUsed.length < orderedClaims.length) {
    warnings.push(`${orderedClaims.length - claimsUsed.length} additional claim(s) were omitted from the draft (max_claims=${maxClaims}).`);
  }
  if (orderedClaims.length === 0) {
    if (isPlainObject(brief.intent) && isNonEmptyString(brief.intent.message)) {
      sentences.push(`Its main message: ${trimTerminalPunctuation(brief.intent.message)}.`);
    } else {
      warnings.push("The brief has no claims and no intent.message; the draft describes only structure and labels.");
    }
  }

  const panels = Array.isArray(brief.inventory)
    ? brief.inventory.filter((item) => isPlainObject(item) && item.kind === "panel")
    : [];
  const panelLabels = panels
    .map((panel) => (isNonEmptyString(panel.label) ? panel.label.trim() : isNonEmptyString(panel.id) ? panel.id.trim() : null))
    .filter(Boolean);
  if (panelLabels.length > 0) {
    const shown = panelLabels.slice(0, maxPanels);
    sentences.push(`It is organized into ${panels.length} panel${panels.length === 1 ? "" : "s"} labeled ${shown.join(", ")}.`);
    if (panelLabels.length > shown.length) {
      warnings.push(`${panelLabels.length - shown.length} additional panel label(s) were omitted from the draft (max_panels=${maxPanels}).`);
    }
  }

  const readingOrder = planUsed && isNonEmptyString(plan.reading_order) ? plan.reading_order.trim() : null;
  if (readingOrder) {
    sentences.push(`The intended reading order is ${readingOrder}.`);
  }

  const labels = Array.isArray(brief.inventory)
    ? brief.inventory
        .filter((item) => isPlainObject(item) && item.kind === "text" && isNonEmptyString(item.text_verbatim))
        .map((item) => item.text_verbatim.trim())
    : [];
  const uniqueLabels = [...new Set(labels)];
  if (uniqueLabels.length > 0) {
    const shown = uniqueLabels.slice(0, maxLabels);
    sentences.push(`Visible text includes ${shown.map((label) => `"${label}"`).join(", ")}.`);
    if (uniqueLabels.length > shown.length) {
      warnings.push(`${uniqueLabels.length - shown.length} additional label(s) were omitted from the draft (max_labels=${maxLabels}).`);
    }
  }

  const altText = sentences.join(" ");
  return {
    schema: ALT_TEXT_SCHEMA_VERSION,
    alt_text: altText,
    word_count: altText.split(/\s+/).filter(Boolean).length,
    sources: {
      figure_kind: kind,
      archetype,
      claims_used: describedClaims.map((claim) => claim.id.trim()),
      panels_used: panels
        .slice(0, maxPanels)
        .map((panel) => (isNonEmptyString(panel.id) ? panel.id.trim() : null))
        .filter(Boolean),
      labels_used: uniqueLabels.slice(0, maxLabels),
      plan_used: planUsed,
    },
    warnings,
  };
}

// Figure Knowledge (P1): retrieval for the Figure Intelligence layer.
//
// - figure_kind_get(kind): one page per scientific-information structure in
//   references/figure-kinds/<kind>.md (semantic primitives, layout
//   archetypes, encoding conventions, common failure modes, boundaries).
// - profile quality rules: references/profiles/<profile>.md ("what makes a
//   good figure" for a delivery context). The machine-readable default
//   parameters stay in references/profiles/defaults.json (figure-truth) and
//   are combined here so one call returns both.
//
// The bundled documents are the single source of truth shipped with the
// plugin; these functions never invent content and fail loudly when a page is
// missing. Publisher numbers are a separate layer (publication compliance)
// and deliberately do not appear in these documents; the loose machine
// defaults stay in references/profiles/defaults.json.

import { readFileSync } from "node:fs";
import { KNOWN_FIGURE_KINDS, KNOWN_PROFILES, readProfileDefaults } from "./figure-truth.mjs";

export const KIND_DOCUMENT_DIRECTORY = "references/figure-kinds";
export const PROFILE_DOCUMENT_DIRECTORY = "references/profiles";

function readBundledDocument(relativePath) {
  try {
    return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
  } catch (error) {
    throw new Error(`Bundled knowledge document ${relativePath} is unavailable: ${error.message}`);
  }
}

// Returns the grammar page for one figure kind. Unknown kinds fail loudly
// with the full list so a mis-typed kind cannot silently select a grammar.
export function readFigureKind(kind) {
  if (typeof kind !== "string" || !kind.trim()) {
    throw new Error("kind must be a non-empty string.");
  }
  const id = kind.trim();
  if (!KNOWN_FIGURE_KINDS.includes(id)) {
    throw new Error(`kind "${id}" is not one of the known figure kinds (${KNOWN_FIGURE_KINDS.join(", ")}).`);
  }
  const source = `${KIND_DOCUMENT_DIRECTORY}/${id}.md`;
  return { kind: id, markdown: readBundledDocument(source), source };
}

// Returns the quality rules for one design profile together with the
// machine-readable default parameters. Profile validation happens once here;
// readProfileDefaults repeats it defensively but the messages agree.
export function readProfileKnowledge(profile) {
  if (typeof profile !== "string" || !profile.trim()) {
    throw new Error("profile must be a non-empty string.");
  }
  const id = profile.trim();
  if (!KNOWN_PROFILES.includes(id)) {
    throw new Error(`profile "${id}" is not one of the known profiles (${KNOWN_PROFILES.join(", ")}).`);
  }
  const defaults = readProfileDefaults(id);
  const source = `${PROFILE_DOCUMENT_DIRECTORY}/${id}.md`;
  return {
    profile: id,
    quality_rules: { markdown: readBundledDocument(source), source },
    parameters: defaults.parameters,
    source: defaults.source,
  };
}

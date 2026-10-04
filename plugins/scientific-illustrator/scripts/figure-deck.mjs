// Deck truth persistence (deck.json) for slide decks.
//
// A deck document records the deck-level truth that per-slide briefs cannot
// hold: the narrative arc, the ordered slide list with roles, the shared
// style/profile reference, and profile settings. Slide briefs themselves are
// regular brief@1 documents (written through figure_brief_write with an
// explicit brief_path); the deck only references them.
//
// Placement follows the same three-level discovery as the other figure
// documents:
//   1. explicit deck_path (highest priority);
//   2. nearest ancestor .scientific-illustrator/ -> decks/<stem>/deck.json;
//   3. sibling <stem>.si-deck.json next to the artifact.
//
// Lifecycle mirrors figure briefs: optimistic locking on expected_revision,
// tool-managed revision/created_at/updated_at, refusal to overwrite across
// schema versions, and refusal to write over an invalid existing file.
import { promises as fs } from "node:fs";
import path from "node:path";
import { assertAllowedRealPath, atomicWrite } from "./guardrails.mjs";
import { KNOWN_PROFILES, readProfileDefaults, resolveFigureDocumentTarget, slugifyFigureId } from "./figure-truth.mjs";

export const DECK_SCHEMA_VERSION = "scientific-illustrator/deck@1";

// Slide roles follow the design-intelligence narrative model; unknown roles
// are preserved with a warning so the vocabulary can grow forward-compatibly.
export const KNOWN_SLIDE_ROLES = [
  "title",
  "outline",
  "background",
  "question",
  "method",
  "result",
  "discussion",
  "conclusion",
  "summary",
  "backup",
  "other",
];

const KNOWN_DECK_FIELDS = new Set([
  "schema",
  "deck_id",
  "title",
  "profile",
  "style_id",
  "profile_settings",
  "narrative",
  "slides",
  "extensions",
  "revision",
  "created_at",
  "updated_at",
]);

const KNOWN_NARRATIVE_FIELDS = new Set(["arc", "message"]);
const KNOWN_SLIDE_FIELDS = new Set(["id", "role", "message", "brief"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function validateDeck(document) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(document)) {
    errors.push("Deck document must be a JSON object.");
    return { errors, warnings };
  }
  if (document.schema !== DECK_SCHEMA_VERSION) {
    errors.push(`schema must be "${DECK_SCHEMA_VERSION}" (got ${JSON.stringify(document.schema)}).`);
  }
  if (!requireNonEmptyString(document.deck_id)) {
    errors.push("deck_id must be a non-empty string.");
  }
  if (document.title !== undefined && !requireNonEmptyString(document.title)) {
    errors.push("title must be a non-empty string when present.");
  }
  if (document.profile !== undefined) {
    if (!requireNonEmptyString(document.profile)) {
      errors.push("profile must be a non-empty string when present.");
    } else if (!KNOWN_PROFILES.includes(document.profile)) {
      warnings.push(
        `profile "${document.profile}" is not one of the known profiles (${KNOWN_PROFILES.join(", ")}); preserved for forward compatibility.`
      );
    }
  }
  if (document.style_id !== undefined && document.style_id !== null && !requireNonEmptyString(document.style_id)) {
    errors.push("style_id must be a non-empty string or null when present.");
  }
  if (document.profile_settings !== undefined) {
    if (!isPlainObject(document.profile_settings)) {
      errors.push("profile_settings must be an object when present.");
    } else {
      const profile = requireNonEmptyString(document.profile) ? document.profile : "slides";
      let known = null;
      try {
        known = readProfileDefaults(profile).parameters;
      } catch {
        known = null; // defaults unavailable: skip parameter warnings
      }
      if (known) {
        for (const key of Object.keys(document.profile_settings)) {
          if (!Object.prototype.hasOwnProperty.call(known, key)) {
            warnings.push(`profile_settings.${key} is not a known parameter for profile "${profile}".`);
          }
        }
      }
    }
  }
  if (document.narrative !== undefined) {
    if (!isPlainObject(document.narrative)) {
      errors.push("narrative must be an object when present.");
    } else {
      for (const key of Object.keys(document.narrative)) {
        if (!KNOWN_NARRATIVE_FIELDS.has(key)) warnings.push(`narrative.${key} is not a known field.`);
      }
      if (document.narrative.arc !== undefined) {
        if (!Array.isArray(document.narrative.arc) || document.narrative.arc.some((step) => !requireNonEmptyString(step))) {
          errors.push("narrative.arc must be an array of non-empty strings when present.");
        }
      }
      if (document.narrative.message !== undefined && !requireNonEmptyString(document.narrative.message)) {
        errors.push("narrative.message must be a non-empty string when present.");
      }
    }
  }
  if (document.extensions !== undefined && !isPlainObject(document.extensions)) {
    errors.push("extensions must be an object when present.");
  }
  if (document.revision !== undefined && (!Number.isInteger(document.revision) || document.revision < 0)) {
    errors.push("revision must be a non-negative integer when present.");
  }
  if (!Array.isArray(document.slides)) {
    errors.push("slides must be an array.");
  } else {
    const ids = new Set();
    document.slides.forEach((slide, index) => {
      const label = `slides[${index}]`;
      if (!isPlainObject(slide)) {
        errors.push(`${label} must be an object.`);
        return;
      }
      if (!requireNonEmptyString(slide.id)) {
        errors.push(`${label}.id must be a non-empty string.`);
      } else if (ids.has(slide.id)) {
        errors.push(`slides contain duplicate id "${slide.id}".`);
      } else {
        ids.add(slide.id);
      }
      if (slide.role !== undefined) {
        if (!requireNonEmptyString(slide.role)) {
          errors.push(`${label}.role must be a non-empty string when present.`);
        } else if (!KNOWN_SLIDE_ROLES.includes(slide.role)) {
          warnings.push(`${label}.role "${slide.role}" is not one of the known roles (${KNOWN_SLIDE_ROLES.join(", ")}).`);
        }
      }
      if (slide.message !== undefined && !requireNonEmptyString(slide.message)) {
        errors.push(`${label}.message must be a non-empty string when present.`);
      }
      if (slide.brief !== undefined) {
        if (!requireNonEmptyString(slide.brief)) {
          errors.push(`${label}.brief must be a non-empty relative path when present.`);
        } else if (path.isAbsolute(slide.brief) || slide.brief.split(/[\\/]+/).includes("..")) {
          errors.push(`${label}.brief must be a relative path inside the deck directory (no absolute paths or "..").`);
        }
      }
      for (const key of Object.keys(slide)) {
        if (!KNOWN_SLIDE_FIELDS.has(key)) warnings.push(`${label}.${key} is not a known slide field.`);
      }
    });
  }
  for (const key of Object.keys(document)) {
    if (!KNOWN_DECK_FIELDS.has(key)) {
      warnings.push(`Unknown top-level field "${key}" is preserved for forward compatibility.`);
    }
  }
  return { errors, warnings };
}

export async function resolveDeckTarget({ artifactPath, deckPath } = {}) {
  return resolveFigureDocumentTarget({
    artifactPath,
    explicitPath: deckPath,
    explicitParamName: "deck_path",
    subject: "deck",
    projectSubdirectory: "decks",
    projectFileName: (stem) => path.join(stem, "deck.json"),
    siblingFileName: (stem) => `${stem}.si-deck.json`,
  });
}

// Resolves the brief file for one slide entry. An explicit slide.brief path is
// relative to the deck file; otherwise the conventional location
// <deck dir>/slides/<slug>.brief.json is used.
export function slideBriefPath(deckDocument, deckPath, slide) {
  if (!deckPath || typeof deckPath !== "string") throw new Error("deckPath must be a path string.");
  if (!isPlainObject(slide)) throw new Error("slide must be an object.");
  const deckDirectory = path.dirname(deckPath);
  if (requireNonEmptyString(slide.brief)) {
    const resolved = path.resolve(deckDirectory, slide.brief);
    const relative = path.relative(deckDirectory, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`slide.brief "${slide.brief}" escapes the deck directory.`);
    }
    return resolved;
  }
  if (!requireNonEmptyString(slide.id)) throw new Error("slide.id must be a non-empty string.");
  return path.join(deckDirectory, "slides", `${slugifyFigureId(slide.id)}.brief.json`);
}

export async function readDeck({ artifactPath, deckPath } = {}) {
  const { target, resolutionBasis } = await resolveDeckTarget({ artifactPath, deckPath });
  const allowed = await assertAllowedRealPath(target);
  let raw = null;
  try {
    raw = await fs.readFile(allowed, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        document: null,
        resolved_path: target,
        resolution_basis: resolutionBasis,
        revision: null,
        schema_warnings: [],
        exists: false,
      };
    }
    throw error;
  }
  let document;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Deck at ${target} is not valid JSON: ${error.message}`);
  }
  const { errors, warnings } = validateDeck(document);
  if (errors.length) throw new Error(`Deck at ${target} is invalid:\n${errors.join("\n")}`);
  if (!Number.isInteger(document.revision) || document.revision < 0) {
    warnings.push("revision is missing; it is tool-managed and will be set on the next write.");
  }
  return {
    document,
    resolved_path: target,
    resolution_basis: resolutionBasis,
    revision: Number.isInteger(document.revision) ? document.revision : null,
    schema_warnings: warnings,
    exists: true,
  };
}

export async function writeDeck({ artifactPath, deckPath, document, expectedRevision } = {}) {
  const { target, resolutionBasis } = await resolveDeckTarget({ artifactPath, deckPath });
  const { errors, warnings } = validateDeck(document);
  if (errors.length) throw new Error(`Deck document is invalid:\n${errors.join("\n")}`);

  let raw = null;
  try {
    raw = await fs.readFile(await assertAllowedRealPath(target), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  let existing = null;
  if (raw !== null) {
    try {
      existing = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Existing deck at ${target} is not valid JSON; fix or delete it before writing: ${error.message}`);
    }
    if (!isPlainObject(existing)) {
      throw new Error(`Existing deck at ${target} is not a JSON object; fix or delete it before writing.`);
    }
  }

  const hasExpectedRevision = expectedRevision !== undefined && expectedRevision !== null;
  if (hasExpectedRevision && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) {
    throw new Error(`expected_revision must be a non-negative integer (got ${JSON.stringify(expectedRevision)}).`);
  }

  const now = new Date().toISOString();
  const next = { ...document };
  let revision;
  let created;

  if (existing) {
    if (existing.schema !== DECK_SCHEMA_VERSION) {
      throw new Error(
        `Existing deck at ${target} uses schema "${existing.schema}"; refusing to overwrite across schema versions.`
      );
    }
    if (!Number.isInteger(existing.revision) || existing.revision < 0) {
      throw new Error(
        `Existing deck at ${target} has an invalid or missing revision (${JSON.stringify(existing.revision)}); fix or delete it before writing.`
      );
    }
    const currentRevision = existing.revision;
    if (!hasExpectedRevision) {
      throw new Error(
        `Deck already exists at ${target} (revision ${currentRevision}); pass expected_revision=${currentRevision} to update it.`
      );
    }
    if (expectedRevision !== currentRevision) {
      throw new Error(
        `expected_revision ${expectedRevision} does not match the current revision ${currentRevision} at ${target}; re-read and merge before writing.`
      );
    }
    if (existing.deck_id && next.deck_id && existing.deck_id !== next.deck_id) {
      warnings.push(`deck_id changed from "${existing.deck_id}" to "${next.deck_id}".`);
    }
    revision = currentRevision + 1;
    created = false;
    next.created_at = existing.created_at || now;
  } else {
    if (hasExpectedRevision && expectedRevision !== 0) {
      throw new Error(`No deck exists at ${target}; expected_revision must be 0 (or omitted) for creation.`);
    }
    revision = 0;
    created = true;
    next.created_at = now;
  }

  if (document.created_at !== undefined) {
    warnings.push("created_at is tool-managed; the provided value was ignored.");
  }
  if (document.revision !== undefined && document.revision !== revision) {
    warnings.push(`revision is tool-managed; provided value ${document.revision} was replaced by ${revision}.`);
  }
  next.updated_at = now;
  next.revision = revision;

  await atomicWrite(target, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return {
    resolved_path: target,
    resolution_basis: resolutionBasis,
    revision,
    created,
    schema_warnings: warnings,
  };
}

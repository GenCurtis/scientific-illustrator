// Figure Style (P0d/P1): the shared manuscript visual system stored at
// .scientific-illustrator/styles/<style_id>.json (or <style_id>.si-style.json
// next to the artifact when no project directory exists). The style is the
// cross-figure visual language — palette, fonts, lines, panel labels, chart
// conventions, geometry/spacing conventions, and semantic_styles (scientific
// identity -> visual identity) — that keeps every figure of one manuscript
// consistent.
//
// Lifecycle mirrors figure-truth: strict validation, three-level resolution
// (explicit style_path > project styles/<style_id>.json > sibling
// <style_id>.si-style.json), tool-managed revision/created_at/updated_at,
// optimistic locking, atomic writes, unknown fields preserved and warned.
// The theme/spacing blocks are structurally validated in P1; their deep
// field-level schemas arrive with the checks that consume them (Perceptual QA).

import { promises as fs } from "node:fs";
import { assertAllowedRealPath, atomicWrite } from "./guardrails.mjs";
import { KNOWN_PROFILES, resolveFigureDocumentTarget } from "./figure-truth.mjs";

export const STYLE_SCHEMA_VERSION = "scientific-illustrator/style@1";

const KNOWN_STYLE_FIELDS = new Set([
  "schema",
  "style_id",
  "name",
  "palette",
  "fonts",
  "lines",
  "panel_labels",
  "charts",
  "spacing",
  "panel_gutter",
  "shape_language",
  "corner_radius",
  "connector_style",
  "arrowheads",
  "callout_style",
  "annotation_style",
  "marker_shapes",
  "image_border",
  "scale_bar_style",
  "legend_style",
  "uncertainty_style",
  "semantic_styles",
  "enforce",
  "applicable_profiles",
  "extensions",
  "revision",
  "created_at",
  "updated_at",
]);

// Structural-only in P1: these blocks accept an object, a non-empty string,
// or a finite number. Their deep schemas arrive with the checks that consume
// them (Perceptual QA); until then a structural type guard prevents garbage
// from masquerading as a visual system.
const LOOSE_STYLE_BLOCKS = [
  "spacing",
  "panel_gutter",
  "shape_language",
  "corner_radius",
  "connector_style",
  "arrowheads",
  "callout_style",
  "annotation_style",
  "marker_shapes",
  "image_border",
  "scale_bar_style",
  "legend_style",
  "uncertainty_style",
];

const SEMANTIC_STYLE_KEYS = ["color", "marker", "line_style"];

const STYLE_ENFORCE_VALUES = ["advisory", "hard"];

const DEFAULT_STYLE_ID = "main";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Full visual-system validation (P1). Theme blocks stay loosely typed
// objects; geometry/spacing blocks accept object/string/number structurally;
// semantic_styles is validated entry by entry because it is the contract that
// keeps experimental conditions visually identical across figures.
// Structural problems are errors; forward-compatible surprises are warnings
// the caller must surface.
export function validateStyle(document) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(document)) {
    errors.push("Style document must be a JSON object.");
    return { errors, warnings };
  }
  if (document.schema !== STYLE_SCHEMA_VERSION) {
    errors.push(`schema must be "${STYLE_SCHEMA_VERSION}" (got ${JSON.stringify(document.schema)}).`);
  }
  if (typeof document.style_id !== "string" || !document.style_id.trim()) {
    errors.push("style_id must be a non-empty string.");
  }
  if (document.name !== undefined && (typeof document.name !== "string" || !document.name.trim())) {
    errors.push("name must be a non-empty string when present.");
  }
  for (const key of ["palette", "fonts", "lines", "panel_labels", "charts", "extensions"]) {
    if (document[key] !== undefined && !isPlainObject(document[key])) {
      errors.push(`${key} must be an object when present.`);
    }
  }
  for (const key of LOOSE_STYLE_BLOCKS) {
    if (document[key] === undefined) continue;
    const value = document[key];
    const valid =
      isPlainObject(value) || (typeof value === "string" && value.trim() !== "") || (typeof value === "number" && Number.isFinite(value));
    if (!valid) {
      errors.push(`${key} must be an object, a non-empty string, or a finite number when present.`);
    }
  }
  if (document.semantic_styles !== undefined) {
    if (!isPlainObject(document.semantic_styles)) {
      errors.push("semantic_styles must be an object mapping scientific identities to visual treatments when present.");
    } else {
      for (const [identity, treatment] of Object.entries(document.semantic_styles)) {
        const label = `semantic_styles.${identity}`;
        if (!identity.trim()) {
          errors.push("semantic_styles keys must be non-empty strings.");
          continue;
        }
        if (!isPlainObject(treatment)) {
          errors.push(`${label} must be an object.`);
          continue;
        }
        const declared = SEMANTIC_STYLE_KEYS.filter((key) => treatment[key] !== undefined);
        if (declared.length === 0) {
          errors.push(`${label} must declare at least one of ${SEMANTIC_STYLE_KEYS.join(", ")}.`);
        }
        for (const key of declared) {
          if (typeof treatment[key] !== "string" || !treatment[key].trim()) {
            errors.push(`${label}.${key} must be a non-empty string.`);
          }
        }
        for (const key of Object.keys(treatment)) {
          if (!SEMANTIC_STYLE_KEYS.includes(key)) {
            warnings.push(`Unknown field "${label}.${key}" was preserved.`);
          }
        }
      }
    }
  }
  if (document.enforce !== undefined && !STYLE_ENFORCE_VALUES.includes(document.enforce)) {
    errors.push(`enforce must be one of ${STYLE_ENFORCE_VALUES.join(", ")} when present.`);
  }
  if (document.applicable_profiles !== undefined) {
    if (!Array.isArray(document.applicable_profiles)) {
      errors.push("applicable_profiles must be an array when present.");
    } else {
      document.applicable_profiles.forEach((profile, index) => {
        if (typeof profile !== "string" || !profile.trim()) {
          errors.push(`applicable_profiles[${index}] must be a non-empty string.`);
        } else if (!KNOWN_PROFILES.includes(profile)) {
          warnings.push(
            `applicable_profiles[${index}] "${profile}" is not one of the known profiles (${KNOWN_PROFILES.join(", ")}); preserved for forward compatibility.`
          );
        }
      });
    }
  }
  if (document.revision !== undefined && (!Number.isInteger(document.revision) || document.revision < 0)) {
    errors.push("revision must be a non-negative integer when present.");
  }
  for (const key of Object.keys(document)) {
    if (!KNOWN_STYLE_FIELDS.has(key)) {
      warnings.push(
        `Unknown field "${key}" was preserved. Move experimental fields under "extensions" to silence this warning.`
      );
    }
  }
  return { errors, warnings };
}

// style_id doubles as the file name component, so it must stay filename-safe.
export function normalizeStyleId(styleId) {
  if (styleId === undefined || styleId === null) return null;
  if (typeof styleId !== "string" || !styleId.trim()) {
    throw new Error("style_id must be a non-empty string when provided.");
  }
  const id = styleId.trim();
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(id) || id === "." || id === "..") {
    throw new Error(`style_id ${JSON.stringify(id)} must be a filename-safe string.`);
  }
  return id;
}

// Effective id used for resolution and identity checks: an explicit style_id
// wins; otherwise an explicit style_path skips the identity check (the file
// itself declares its id); otherwise the default "main" applies.
function effectiveStyleId({ styleId, stylePath }) {
  const explicit = normalizeStyleId(styleId);
  if (explicit) return explicit;
  if (stylePath !== undefined && stylePath !== null) return null;
  return DEFAULT_STYLE_ID;
}

export async function resolveStyleTarget({ artifactPath, stylePath, styleId } = {}) {
  const id = effectiveStyleId({ styleId, stylePath });
  return resolveFigureDocumentTarget({
    artifactPath,
    explicitPath: stylePath,
    explicitParamName: "style_path",
    subject: "figure_style",
    projectSubdirectory: "styles",
    projectFileName: () => `${id}.json`,
    siblingFileName: () => `${id}.si-style.json`,
  });
}

// Reads and validates the resolved style. A missing style is a normal state
// (document=null, exists=false): a project may run without a style contract
// and fall back to profile defaults. A structurally invalid style throws.
export async function readFigureStyle({ artifactPath, stylePath, styleId } = {}) {
  const id = effectiveStyleId({ styleId, stylePath });
  const { target, resolutionBasis } = await resolveStyleTarget({ artifactPath, stylePath, styleId });
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
    throw new Error(`Style at ${target} is not valid JSON: ${error.message}`);
  }
  const { errors, warnings } = validateStyle(document);
  if (errors.length) throw new Error(`Style at ${target} is invalid:\n${errors.join("\n")}`);
  if (id && document.style_id !== id) {
    throw new Error(
      `Style at ${target} declares style_id ${JSON.stringify(document.style_id)} but was requested as "${id}"; fix the file or pass the matching style_id.`
    );
  }
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

// Creates (revision 0) or updates (expected_revision + 1) the style document.
// Same concurrency semantics as figure-truth: tool-managed revision and
// timestamps, stale expected_revision fails loudly.
export async function writeFigureStyle({ artifactPath, stylePath, styleId, document, expectedRevision } = {}) {
  const id = effectiveStyleId({ styleId, stylePath });
  const { target, resolutionBasis } = await resolveStyleTarget({ artifactPath, stylePath, styleId });
  const { errors, warnings } = validateStyle(document);
  if (errors.length) throw new Error(`Style document is invalid:\n${errors.join("\n")}`);
  if (id && document.style_id !== id) {
    throw new Error(
      `Style document style_id ${JSON.stringify(document.style_id)} does not match the requested style_id "${id}".`
    );
  }

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
      throw new Error(`Existing style at ${target} is not valid JSON; fix or delete it before writing: ${error.message}`);
    }
    if (!isPlainObject(existing)) {
      throw new Error(`Existing style at ${target} is not a JSON object; fix or delete it before writing.`);
    }
    if (id && existing.style_id !== undefined && existing.style_id !== id) {
      throw new Error(
        `Existing style at ${target} declares style_id ${JSON.stringify(existing.style_id)} but was requested as "${id}"; fix the file or pass the matching style_id.`
      );
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
    if (existing.schema !== STYLE_SCHEMA_VERSION) {
      throw new Error(
        `Existing style at ${target} uses schema "${existing.schema}"; refusing to overwrite across schema versions.`
      );
    }
    if (!Number.isInteger(existing.revision) || existing.revision < 0) {
      throw new Error(
        `Existing style at ${target} has an invalid or missing revision (${JSON.stringify(existing.revision)}); fix or delete it before writing.`
      );
    }
    const currentRevision = existing.revision;
    if (!hasExpectedRevision) {
      throw new Error(
        `Style already exists at ${target} (revision ${currentRevision}); pass expected_revision=${currentRevision} to update it.`
      );
    }
    if (expectedRevision !== currentRevision) {
      throw new Error(
        `expected_revision ${expectedRevision} does not match the current revision ${currentRevision} at ${target}; re-read and merge before writing.`
      );
    }
    if (existing.style_id && next.style_id && existing.style_id !== next.style_id) {
      warnings.push(`style_id changed from "${existing.style_id}" to "${next.style_id}".`);
    }
    revision = currentRevision + 1;
    created = false;
    next.created_at = existing.created_at || now;
  } else {
    if (hasExpectedRevision && expectedRevision !== 0) {
      throw new Error(`No style exists at ${target}; expected_revision must be 0 (or omitted) for creation.`);
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
  return { resolved_path: target, resolution_basis: resolutionBasis, revision, created, schema_warnings: warnings };
}

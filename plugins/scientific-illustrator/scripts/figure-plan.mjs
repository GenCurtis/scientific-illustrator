// Design Plan (P1b): the figure-level design explanation stored at
// .scientific-illustrator/figures/<slug>.plan.json (or <slug>.si-plan.json
// next to the artifact when no project directory exists).
//
// A plan is regenerable and discardable: it records how the scientific truth
// is to be expressed (kind, archetype, reading order, encoding, hierarchy,
// layout constraints, render contexts) but never carries truth itself —
// claims, verbatim text, units, and waivers stay in the brief. The Reviewer
// judges truth correctness against the brief, design quality against the plan
// and the figure-kind grammar, and publication compliance against the spec.
//
// Lifecycle mirrors figure-truth/figure-style: strict validation, three-level
// resolution, tool-managed revision/created_at/updated_at, optimistic
// locking, atomic writes, unknown fields preserved and warned. A brief_path
// anchors the plan whenever it is given (the plan is resolved next to that
// brief by replacing the brief suffix: .brief.json -> .plan.json,
// .si-brief.json -> .si-plan.json); a co-supplied artifact_path is only
// validated and reported. Without a brief_path, the three-level artifact
// discovery applies.

import { promises as fs } from "node:fs";
import path from "node:path";
import { assertAllowedPath, assertAllowedRealPath, atomicWrite } from "./guardrails.mjs";
import {
  KNOWN_FIGURE_KINDS,
  normalizePathArgument,
  resolveFigureDocumentTarget,
} from "./figure-truth.mjs";

export const PLAN_SCHEMA_VERSION = "scientific-illustrator/design-plan@1";

// Render contexts (P3): entries are either a bare context id or an object
// {id, width_mm | width_px} carrying the target delivery size used by
// Perceptual QA. Unknown members warn instead of failing so plans stay
// forward-compatible.
export const KNOWN_RENDER_CONTEXTS = ["publication", "screen", "screen-preview", "thumbnail"];

const KNOWN_PLAN_FIELDS = new Set([
  "schema",
  "figure_id",
  "figure_kind",
  "archetype",
  "reading_order",
  "primary_claims",
  "encoding",
  "hierarchy",
  "layout_constraints",
  "render_contexts",
  "extensions",
  "revision",
  "created_at",
  "updated_at",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireNonEmptyString(value, label, errors) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${label} must be a non-empty string.`);
    return false;
  }
  return true;
}

function warnUnknownRenderContext(id, label, warnings) {
  const normalized = id.trim();
  if (!KNOWN_RENDER_CONTEXTS.includes(normalized)) {
    warnings.push(
      `${label} "${normalized}" is not one of the known contexts (${KNOWN_RENDER_CONTEXTS.join(", ")}); preserved for forward compatibility.`
    );
  }
}

// Structural problems are errors; forward-compatible surprises are warnings.
export function validatePlan(document) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(document)) {
    errors.push("Plan document must be a JSON object.");
    return { errors, warnings };
  }
  if (document.schema !== PLAN_SCHEMA_VERSION) {
    errors.push(`schema must be "${PLAN_SCHEMA_VERSION}" (got ${JSON.stringify(document.schema)}).`);
  }
  requireNonEmptyString(document.figure_id, "figure_id", errors);
  if (requireNonEmptyString(document.figure_kind, "figure_kind", errors) && !KNOWN_FIGURE_KINDS.includes(document.figure_kind)) {
    warnings.push(
      `figure_kind "${document.figure_kind}" is not one of the known kinds (${KNOWN_FIGURE_KINDS.join(", ")}); preserved for forward compatibility.`
    );
  }
  requireNonEmptyString(document.archetype, "archetype", errors);
  if (document.reading_order !== undefined) {
    requireNonEmptyString(document.reading_order, "reading_order", errors);
  }
  if (document.primary_claims !== undefined) {
    if (!Array.isArray(document.primary_claims)) {
      errors.push("primary_claims must be an array of claim ids when present.");
    } else {
      const seen = new Set();
      document.primary_claims.forEach((claim, index) => {
        if (!requireNonEmptyString(claim, `primary_claims[${index}]`, errors)) return;
        if (seen.has(claim)) warnings.push(`primary_claims[${index}] "${claim}" is duplicated.`);
        else seen.add(claim);
      });
    }
  }
  if (document.encoding !== undefined) {
    if (!isPlainObject(document.encoding)) {
      errors.push("encoding must be an object mapping semantic roles to visual treatments when present.");
    } else {
      for (const [role, treatment] of Object.entries(document.encoding)) {
        requireNonEmptyString(treatment, `encoding.${role}`, errors);
      }
    }
  }
  if (document.hierarchy !== undefined) {
    if (!isPlainObject(document.hierarchy)) {
      errors.push("hierarchy must be an object when present.");
    } else {
      for (const tier of ["primary", "secondary"]) {
        if (document.hierarchy[tier] === undefined) continue;
        if (!Array.isArray(document.hierarchy[tier])) {
          errors.push(`hierarchy.${tier} must be an array of ids when present.`);
          continue;
        }
        document.hierarchy[tier].forEach((entry, index) => {
          requireNonEmptyString(entry, `hierarchy.${tier}[${index}]`, errors);
        });
      }
      for (const key of Object.keys(document.hierarchy)) {
        if (key !== "primary" && key !== "secondary") {
          warnings.push(`Unknown field "hierarchy.${key}" was preserved.`);
        }
      }
    }
  }
  if (document.layout_constraints !== undefined) {
    if (!isPlainObject(document.layout_constraints)) {
      errors.push("layout_constraints must be an object when present.");
    } else {
      const constraints = document.layout_constraints;
      if (constraints.avoid_connector_crossing !== undefined && typeof constraints.avoid_connector_crossing !== "boolean") {
        errors.push("layout_constraints.avoid_connector_crossing must be a boolean when present.");
      }
      if (constraints.minimum_panel_gutter_mm !== undefined) {
        if (typeof constraints.minimum_panel_gutter_mm !== "number" || !Number.isFinite(constraints.minimum_panel_gutter_mm) || constraints.minimum_panel_gutter_mm < 0) {
          errors.push("layout_constraints.minimum_panel_gutter_mm must be a non-negative number when present.");
        }
      }
      for (const key of Object.keys(constraints)) {
        if (key !== "avoid_connector_crossing" && key !== "minimum_panel_gutter_mm") {
          warnings.push(`Unknown field "layout_constraints.${key}" was preserved.`);
        }
      }
    }
  }
  if (document.render_contexts !== undefined) {
    if (!Array.isArray(document.render_contexts)) {
      errors.push("render_contexts must be an array when present.");
    } else {
      document.render_contexts.forEach((context, index) => {
        const label = `render_contexts[${index}]`;
        if (typeof context === "string") {
          if (!requireNonEmptyString(context, label, errors)) return;
          warnUnknownRenderContext(context, label, warnings);
          return;
        }
        if (!isPlainObject(context)) {
          errors.push(`${label} must be a context id string or an object with an "id".`);
          return;
        }
        if (!requireNonEmptyString(context.id, `${label}.id`, errors)) return;
        warnUnknownRenderContext(context.id, label, warnings);
        const hasMm = context.width_mm !== undefined;
        const hasPx = context.width_px !== undefined;
        if (hasMm && hasPx) {
          errors.push(`${label} must not set both width_mm and width_px.`);
        }
        if (hasMm && (typeof context.width_mm !== "number" || !Number.isFinite(context.width_mm) || context.width_mm <= 0)) {
          errors.push(`${label}.width_mm must be a positive number when present.`);
        }
        if (hasPx && (typeof context.width_px !== "number" || !Number.isFinite(context.width_px) || context.width_px <= 0)) {
          errors.push(`${label}.width_px must be a positive number when present.`);
        }
        for (const key of Object.keys(context)) {
          if (key !== "id" && key !== "width_mm" && key !== "width_px") {
            warnings.push(`Unknown field "${label}.${key}" was preserved.`);
          }
        }
      });
    }
  }
  if (document.extensions !== undefined && !isPlainObject(document.extensions)) {
    errors.push("extensions must be an object when present.");
  }
  if (document.revision !== undefined && (!Number.isInteger(document.revision) || document.revision < 0)) {
    errors.push("revision must be a non-negative integer when present.");
  }
  for (const key of Object.keys(document)) {
    if (!KNOWN_PLAN_FIELDS.has(key)) {
      warnings.push(
        `Unknown field "${key}" was preserved. Move experimental fields under "extensions" to silence this warning.`
      );
    }
  }
  return { errors, warnings };
}

// Plan placement when anchored by the brief instead of the artifact: the plan
// lives beside the brief with the brief suffix swapped. Unknown suffixes get
// ".plan.json" appended to the stem.
export function derivePlanPathFromBrief(briefPath) {
  const directory = path.dirname(briefPath);
  const base = path.basename(briefPath);
  if (/\.si-brief\.json$/i.test(base)) return path.join(directory, base.replace(/\.si-brief\.json$/i, ".si-plan.json"));
  if (/\.brief\.json$/i.test(base)) return path.join(directory, base.replace(/\.brief\.json$/i, ".plan.json"));
  const stem = path.parse(briefPath).name;
  return path.join(directory, `${stem}.plan.json`);
}

export async function resolvePlanTarget({ artifactPath, briefPath } = {}) {
  // An explicit brief_path is the highest-priority anchor, matching the
  // figure_brief/figure_style explicit-path semantics: the plan is resolved
  // next to that brief. An artifact_path alongside it is only validated (and
  // used for reporting the artifact directory), never silently preferred.
  if (briefPath !== undefined && briefPath !== null) {
    const target = assertAllowedPath(normalizePathArgument(briefPath, "brief_path"));
    const artifactDirectory =
      artifactPath !== undefined && artifactPath !== null
        ? path.dirname(assertAllowedPath(normalizePathArgument(artifactPath, "artifact_path")))
        : null;
    return { target: derivePlanPathFromBrief(target), resolutionBasis: "brief", artifactDirectory };
  }
  if (artifactPath !== undefined && artifactPath !== null) {
    return resolveFigureDocumentTarget({
      artifactPath,
      projectFileName: (stem) => `${stem}.plan.json`,
      siblingFileName: (stem) => `${stem}.si-plan.json`,
    });
  }
  throw new Error("figure_plan requires artifact_path or brief_path.");
}

// Reads and validates the resolved plan. A missing plan is a normal state
// (document=null, exists=false): plans are regenerable by design.
export async function readFigurePlan({ artifactPath, briefPath } = {}) {
  const { target, resolutionBasis } = await resolvePlanTarget({ artifactPath, briefPath });
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
    throw new Error(`Plan at ${target} is not valid JSON: ${error.message}`);
  }
  const { errors, warnings } = validatePlan(document);
  if (errors.length) throw new Error(`Plan at ${target} is invalid:\n${errors.join("\n")}`);
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

// Creates (revision 0) or updates (expected_revision + 1) the plan. Same
// concurrency semantics as figure-truth/figure-style: tool-managed revision
// and timestamps, stale expected_revision fails loudly.
export async function writeFigurePlan({ artifactPath, briefPath, document, expectedRevision } = {}) {
  const { target, resolutionBasis } = await resolvePlanTarget({ artifactPath, briefPath });
  const { errors, warnings } = validatePlan(document);
  if (errors.length) throw new Error(`Plan document is invalid:\n${errors.join("\n")}`);

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
      throw new Error(`Existing plan at ${target} is not valid JSON; fix or delete it before writing: ${error.message}`);
    }
    if (!isPlainObject(existing)) {
      throw new Error(`Existing plan at ${target} is not a JSON object; fix or delete it before writing.`);
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
    if (existing.schema !== PLAN_SCHEMA_VERSION) {
      throw new Error(
        `Existing plan at ${target} uses schema "${existing.schema}"; refusing to overwrite across schema versions.`
      );
    }
    if (!Number.isInteger(existing.revision) || existing.revision < 0) {
      throw new Error(
        `Existing plan at ${target} has an invalid or missing revision (${JSON.stringify(existing.revision)}); fix or delete it before writing.`
      );
    }
    const currentRevision = existing.revision;
    if (!hasExpectedRevision) {
      throw new Error(
        `Plan already exists at ${target} (revision ${currentRevision}); pass expected_revision=${currentRevision} to update it.`
      );
    }
    if (expectedRevision !== currentRevision) {
      throw new Error(
        `expected_revision ${expectedRevision} does not match the current revision ${currentRevision} at ${target}; re-read and merge before writing.`
      );
    }
    if (existing.figure_id && next.figure_id && existing.figure_id !== next.figure_id) {
      warnings.push(`figure_id changed from "${existing.figure_id}" to "${next.figure_id}".`);
    }
    revision = currentRevision + 1;
    created = false;
    next.created_at = existing.created_at || now;
  } else {
    if (hasExpectedRevision && expectedRevision !== 0) {
      throw new Error(`No plan exists at ${target}; expected_revision must be 0 (or omitted) for creation.`);
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

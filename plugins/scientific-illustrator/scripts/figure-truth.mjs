// Figure Truth (P0a): persistent figure brief support for the Scientific
// Illustrator file-utilities server. Provides the minimal brief schema
// validation, the three-level path resolution (explicit brief_path > nearest
// ancestor .scientific-illustrator/ > sibling <stem>.si-brief.json), and
// atomic read/write with allowed-root confinement shared through guardrails.
//
// The brief is durable scientific truth (see the planning design docs); the
// design plan is a separate artifact. This module never invents truth: a
// missing brief is reported as exists=false instead of an error.

import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { allowedRoot, assertAllowedPath, assertAllowedRealPath, atomicWrite } from "./guardrails.mjs";

export const BRIEF_SCHEMA_VERSION = "scientific-illustrator/brief@1";

export const KNOWN_PROFILES = ["paper-figure", "graphical-abstract", "poster", "slides", "diagram"];

// Fields the brief@1 schema understands. Everything else is preserved but
// reported as a schema warning so typos cannot masquerade as valid config.
const KNOWN_TOP_LEVEL_FIELDS = new Set([
  "schema",
  "figure_id",
  "profile",
  "style_id",
  "profile_settings",
  "intent",
  "inventory",
  "figure_kind",
  "claims",
  "relations",
  "quantities",
  "source_ambiguities",
  "intentional_deviations",
  "disputes",
  "recreation_policy",
  "acceptance",
  "extensions",
  "revision",
  "created_at",
  "updated_at",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Disposition entries (intentional_deviations, disputes) follow the shared
// approval vocabulary: "user" is the only approval that can waive a hard
// finding or dispute an integrity finding; "agent-with-user-ack" records that
// the agent acted on the user's acknowledgement but is not sufficient for
// those boundary cases.
const DISPOSITION_APPROVERS = new Set(["user", "agent-with-user-ack"]);

function requireNonEmptyString(value, label, errors) {
  if (typeof value !== "string" || !value.trim()) errors.push(`${label} must be a non-empty string.`);
  return typeof value === "string" && value.trim();
}

function validateDispositionEntries(list, label, mode, errors) {
  list.forEach((entry, index) => {
    const entryLabel = `${label}[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${entryLabel} must be an object.`);
      return;
    }
    if (mode === "waiver") {
      requireNonEmptyString(entry.item, `${entryLabel}.item`, errors);
      requireNonEmptyString(entry.category, `${entryLabel}.category`, errors);
    } else {
      requireNonEmptyString(entry.rule_id, `${entryLabel}.rule_id`, errors);
    }
    requireNonEmptyString(entry.reason, `${entryLabel}.reason`, errors);
    if (entry.id !== undefined) requireNonEmptyString(entry.id, `${entryLabel}.id`, errors);
    if (entry.item !== undefined) requireNonEmptyString(entry.item, `${entryLabel}.item`, errors);
    if (entry.rule_version !== undefined) requireNonEmptyString(entry.rule_version, `${entryLabel}.rule_version`, errors);
    if (mode === "dispute") {
      if (!DISPOSITION_APPROVERS.has(entry.approved_by)) {
        errors.push(`${entryLabel}.approved_by must be "user" or "agent-with-user-ack".`);
      }
    } else if (entry.approved_by !== undefined && !DISPOSITION_APPROVERS.has(entry.approved_by)) {
      errors.push(`${entryLabel}.approved_by must be "user" or "agent-with-user-ack" when present.`);
    }
  });
}

// Filesystem-safe slug used for brief file names (<slug>.brief.json). Keeps
// the identification readable for humans while stripping path-hostile
// characters on every supported platform. Long stems are truncated with a
// short content hash so the filename component stays well under the 255-byte
// limit every supported filesystem enforces.
const MAX_SLUG_LENGTH = 80;

export function slugifyFigureId(value) {
  const raw = String(value ?? "");
  const cleaned = raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  const base = cleaned || "figure";
  if (base.length <= MAX_SLUG_LENGTH) return base;
  const digest = createHash("sha256").update(raw).digest("hex").slice(0, 8);
  return `${base.slice(0, MAX_SLUG_LENGTH)}-${digest}`;
}

// Minimal P0a validation. Structural problems are errors; forward-compatible
// surprises (unknown profile, unknown field) are warnings the caller must
// surface instead of silently accepting.
export function validateBrief(document) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(document)) {
    errors.push("Brief document must be a JSON object.");
    return { errors, warnings };
  }
  if (document.schema !== BRIEF_SCHEMA_VERSION) {
    errors.push(`schema must be "${BRIEF_SCHEMA_VERSION}" (got ${JSON.stringify(document.schema)}).`);
  }
  if (typeof document.figure_id !== "string" || !document.figure_id.trim()) {
    errors.push("figure_id must be a non-empty string.");
  }
  if (typeof document.profile !== "string" || !document.profile.trim()) {
    errors.push("profile must be a non-empty string.");
  } else if (!KNOWN_PROFILES.includes(document.profile)) {
    warnings.push(
      `profile "${document.profile}" is not one of the known profiles (${KNOWN_PROFILES.join(", ")}); preserved for forward compatibility.`
    );
  }
  if (document.style_id !== undefined && document.style_id !== null && typeof document.style_id !== "string") {
    errors.push("style_id must be a string or null when present.");
  }
  for (const key of ["profile_settings", "intent", "acceptance", "extensions"]) {
    if (document[key] !== undefined && !isPlainObject(document[key])) {
      errors.push(`${key} must be an object when present.`);
    }
  }
  if (document.figure_kind !== undefined && (typeof document.figure_kind !== "string" || !document.figure_kind.trim())) {
    errors.push("figure_kind must be a non-empty string when present.");
  }
  for (const key of ["claims", "relations", "quantities", "source_ambiguities", "intentional_deviations", "disputes"]) {
    if (document[key] !== undefined && !Array.isArray(document[key])) {
      errors.push(`${key} must be an array when present.`);
    }
  }
  if (Array.isArray(document.intentional_deviations)) {
    validateDispositionEntries(document.intentional_deviations, "intentional_deviations", "waiver", errors);
  }
  if (Array.isArray(document.disputes)) {
    validateDispositionEntries(document.disputes, "disputes", "dispute", errors);
  }
  if (isPlainObject(document.acceptance) && document.acceptance.waivable_categories !== undefined) {
    if (!Array.isArray(document.acceptance.waivable_categories)) {
      errors.push("acceptance.waivable_categories must be an array of strings when present.");
    } else {
      document.acceptance.waivable_categories.forEach((value, index) => {
        requireNonEmptyString(value, `acceptance.waivable_categories[${index}]`, errors);
      });
    }
  }
  if (document.recreation_policy !== undefined && !["faithful", "publication-ready"].includes(document.recreation_policy)) {
    errors.push('recreation_policy must be "faithful" or "publication-ready" when present.');
  }
  if (!Array.isArray(document.inventory)) {
    errors.push("inventory must be an array.");
  } else {
    const seenIds = new Set();
    document.inventory.forEach((item, index) => {
      if (!isPlainObject(item)) {
        errors.push(`inventory[${index}] must be an object.`);
        return;
      }
      if (typeof item.id !== "string" || !item.id.trim()) {
        errors.push(`inventory[${index}].id must be a non-empty string.`);
      } else if (seenIds.has(item.id)) {
        errors.push(`inventory id "${item.id}" is duplicated; ids must stay unique for finding attribution.`);
      } else {
        seenIds.add(item.id);
      }
      if (typeof item.kind !== "string" || !item.kind.trim()) {
        errors.push(`inventory[${index}].kind must be a non-empty string.`);
      }
    });
  }
  if (document.revision !== undefined && (!Number.isInteger(document.revision) || document.revision < 0)) {
    errors.push("revision must be a non-negative integer when present.");
  }
  for (const key of Object.keys(document)) {
    if (!KNOWN_TOP_LEVEL_FIELDS.has(key)) {
      warnings.push(
        `Unknown field "${key}" was preserved. Move experimental fields under "extensions" to silence this warning.`
      );
    }
  }
  return { errors, warnings };
}

function isWithinRoot(resolved, root) {
  const sep = path.sep;
  const base = root.endsWith(sep) ? root.slice(0, -sep.length) : root;
  if (process.platform === "win32") {
    return (
      resolved.toLowerCase() === base.toLowerCase() ||
      resolved.toLowerCase().startsWith(`${base.toLowerCase()}${sep}`)
    );
  }
  return resolved === base || resolved.startsWith(`${base}${sep}`);
}

// Walks up from startDir looking for the nearest .scientific-illustrator/
// directory. When an allowed root is configured, the walk never probes above
// it, so discovery cannot read markers outside the confined surface.
async function findProjectDirectory(startDir, stopAtRoot) {
  let current = path.resolve(startDir);
  for (;;) {
    if (stopAtRoot && !isWithinRoot(current, stopAtRoot)) return null;
    const marker = path.join(current, ".scientific-illustrator");
    try {
      const stat = await fs.stat(marker);
      if (stat.isDirectory()) return current;
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// Path arguments are strict: non-strings and relative paths are rejected
// instead of being coerced or silently resolved against the MCP server's own
// working directory (the plugin install directory, not the user project).
function normalizePathArgument(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty absolute path string.`);
  }
  const trimmed = value.trim();
  const isHomeShorthand = trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\");
  if (!path.isAbsolute(trimmed) && !isHomeShorthand) {
    throw new Error(
      `${name} must be an absolute path (got "${trimmed}"); relative paths would resolve against the MCP server directory.`
    );
  }
  return trimmed;
}

// Three-level resolution shared by figure documents (brief, findings ledger):
//   1. explicit path (highest priority);
//   2. nearest ancestor .scientific-illustrator/ -> figures/<stem>.<kind>.json;
//   3. sibling file next to the artifact.
// The tool never creates .scientific-illustrator/ itself; the user opts into
// the project-level layout by creating that directory once.
async function resolveFigureDocumentTarget({
  artifactPath,
  explicitPath,
  explicitParamName,
  subject,
  projectFileName,
  siblingFileName,
}) {
  if (explicitPath !== undefined && explicitPath !== null) {
    const target = assertAllowedPath(normalizePathArgument(explicitPath, explicitParamName));
    const artifactDirectory =
      artifactPath !== undefined && artifactPath !== null
        ? path.dirname(assertAllowedPath(normalizePathArgument(artifactPath, "artifact_path")))
        : null;
    return { target, resolutionBasis: "explicit", artifactDirectory };
  }
  if (artifactPath === undefined || artifactPath === null) {
    throw new Error(`${subject} requires artifact_path or ${explicitParamName}.`);
  }
  const artifact = assertAllowedPath(normalizePathArgument(artifactPath, "artifact_path"));
  const artifactDirectory = path.dirname(artifact);
  const stem = slugifyFigureId(path.parse(artifact).name);
  const projectDirectory = await findProjectDirectory(artifactDirectory, allowedRoot());
  if (projectDirectory) {
    return {
      target: path.join(projectDirectory, ".scientific-illustrator", "figures", projectFileName(stem)),
      resolutionBasis: "project",
      artifactDirectory,
    };
  }
  return {
    target: path.join(artifactDirectory, siblingFileName(stem)),
    resolutionBasis: "sibling",
    artifactDirectory,
  };
}

export async function resolveBriefTarget({ artifactPath, briefPath } = {}) {
  return resolveFigureDocumentTarget({
    artifactPath,
    explicitPath: briefPath,
    explicitParamName: "brief_path",
    subject: "figure_brief",
    projectFileName: (stem) => `${stem}.brief.json`,
    siblingFileName: (stem) => `${stem}.si-brief.json`,
  });
}

// Findings ledger placement follows the same three levels: an explicit
// findings_path wins, then .scientific-illustrator/figures/<stem>.si-findings.json,
// then a sibling <stem>.si-findings.json next to the artifact.
export async function resolveFindingsTarget({ artifactPath, findingsPath } = {}) {
  return resolveFigureDocumentTarget({
    artifactPath,
    explicitPath: findingsPath,
    explicitParamName: "findings_path",
    subject: "findings_ledger",
    projectFileName: (stem) => `${stem}.si-findings.json`,
    siblingFileName: (stem) => `${stem}.si-findings.json`,
  });
}

// Reads and validates the resolved brief. A missing brief is a normal state
// (document=null, exists=false), not an error. A structurally invalid brief
// throws: the caller must not proceed on unverified truth.
export async function readFigureBrief({ artifactPath, briefPath } = {}) {
  const { target, resolutionBasis } = await resolveBriefTarget({ artifactPath, briefPath });
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
    throw new Error(`Brief at ${target} is not valid JSON: ${error.message}`);
  }
  const { errors, warnings } = validateBrief(document);
  if (errors.length) throw new Error(`Brief at ${target} is invalid:\n${errors.join("\n")}`);
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

// Creates (revision 0) or updates (expected_revision + 1) the brief. The tool
// manages revision/created_at/updated_at; unknown fields are preserved and
// reported. Concurrency follows optimistic locking: a stale expected_revision
// fails loudly instead of clobbering a newer brief.
//
// Optimistic locking guards stale sequential writes within one server process
// (MCP requests are serialized there). Two separate server processes sharing
// the same project can still race (last write wins); that is an accepted P0a
// limitation until multi-writer locking is needed.
export async function writeFigureBrief({ artifactPath, briefPath, document, expectedRevision } = {}) {
  const { target, resolutionBasis } = await resolveBriefTarget({ artifactPath, briefPath });
  const { errors, warnings } = validateBrief(document);
  if (errors.length) throw new Error(`Brief document is invalid:\n${errors.join("\n")}`);

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
      throw new Error(`Existing brief at ${target} is not valid JSON; fix or delete it before writing: ${error.message}`);
    }
    if (!isPlainObject(existing)) {
      throw new Error(`Existing brief at ${target} is not a JSON object; fix or delete it before writing.`);
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
    if (existing.schema !== BRIEF_SCHEMA_VERSION) {
      throw new Error(
        `Existing brief at ${target} uses schema "${existing.schema}"; refusing to overwrite across schema versions.`
      );
    }
    if (!Number.isInteger(existing.revision) || existing.revision < 0) {
      throw new Error(
        `Existing brief at ${target} has an invalid or missing revision (${JSON.stringify(existing.revision)}); fix or delete it before writing.`
      );
    }
    const currentRevision = existing.revision;
    if (!hasExpectedRevision) {
      throw new Error(
        `Brief already exists at ${target} (revision ${currentRevision}); pass expected_revision=${currentRevision} to update it.`
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
      throw new Error(`No brief exists at ${target}; expected_revision must be 0 (or omitted) for creation.`);
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

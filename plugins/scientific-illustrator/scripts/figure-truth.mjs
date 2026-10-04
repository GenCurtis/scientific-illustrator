// Figure Truth (P0a, extended in P0d): persistent figure brief support for the
// Scientific Illustrator file-utilities server. Provides brief schema
// validation (inventory, scientific claims/relations/quantities, source
// ambiguity grading, recreation policy), the three-level path resolution
// (explicit brief_path > nearest ancestor .scientific-illustrator/ > sibling
// <stem>.si-brief.json), atomic read/write with allowed-root confinement
// shared through guardrails, and the machine-readable profile parameter
// defaults served to the figure_profile_get tool.
//
// The brief is durable scientific truth (see the planning design docs); the
// design plan is a separate artifact. This module never invents truth: a
// missing brief is reported as exists=false instead of an error.

import { promises as fs, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { allowedRoot, assertAllowedPath, assertAllowedRealPath, atomicWrite } from "./guardrails.mjs";

export const BRIEF_SCHEMA_VERSION = "scientific-illustrator/brief@1";

export const KNOWN_PROFILES = ["paper-figure", "graphical-abstract", "poster", "slides", "diagram"];

// figure_kind is the scientific-information structure dimension, orthogonal to
// profile (see the figure-intelligence design doc). Unknown values are
// warnings, not errors: the taxonomy may grow (domain subtypes) and the schema
// version manages structural change.
export const KNOWN_FIGURE_KINDS = [
  "data-plot",
  "multi-panel-data",
  "experimental-workflow",
  "mechanism",
  "process",
  "system-architecture",
  "image-panel",
  "spatial",
  "network",
  "mixed-composite",
];

// Source-ambiguity grading: cosmetic never blocks; structural is configurable
// via acceptance.block_on_structural_ambiguity; semantic blocks unresolved in
// publication-ready recreation (see evaluateRecreationGate).
export const KNOWN_AMBIGUITY_SEVERITIES = ["cosmetic", "structural", "semantic"];

export const PROFILE_DEFAULTS_SCHEMA_VERSION = "scientific-illustrator/profile-defaults@1";

const PROFILE_DEFAULTS_SOURCE = "references/profiles/defaults.json";

// Lazily loaded once per process. An invalid or missing defaults file must not
// crash the servers that import this module (findings-ledger -> powerpoint /
// live servers), so the state carries either the parsed document or the load
// error. Explicit readProfileDefaults() calls fail loudly on the error; the
// advisory profile_settings typo check degrades silently.
let profileDefaultsState = null;

function loadProfileDefaultsDocument() {
  if (profileDefaultsState) return profileDefaultsState;
  try {
    const raw = readFileSync(new URL("../references/profiles/defaults.json", import.meta.url), "utf8");
    const document = JSON.parse(raw);
    if (!isPlainObject(document) || document.schema !== PROFILE_DEFAULTS_SCHEMA_VERSION) {
      throw new Error(`expected schema "${PROFILE_DEFAULTS_SCHEMA_VERSION}"`);
    }
    if (!isPlainObject(document.profiles)) throw new Error("profiles must be an object");
    for (const [profile, parameters] of Object.entries(document.profiles)) {
      if (!KNOWN_PROFILES.includes(profile)) throw new Error(`unknown profile "${profile}"`);
      if (!isPlainObject(parameters)) throw new Error(`profiles.${profile} must be an object`);
      for (const [key, spec] of Object.entries(parameters)) {
        if (!isPlainObject(spec)) throw new Error(`profiles.${profile}.${key} must be a parameter object`);
      }
    }
    profileDefaultsState = { document };
  } catch (error) {
    profileDefaultsState = { error };
  }
  return profileDefaultsState;
}

function knownProfileParameterKeys(profile) {
  const state = loadProfileDefaultsDocument();
  if (state.error) return null;
  const parameters = state.document.profiles[profile];
  return parameters ? new Set(Object.keys(parameters)) : null;
}

// Explicit read used by figure_profile_get: unknown profiles and a broken
// defaults file are errors here, because the caller asked for this data.
export function readProfileDefaults(profile) {
  if (typeof profile !== "string" || !profile.trim()) {
    throw new Error("profile must be a non-empty string.");
  }
  if (!KNOWN_PROFILES.includes(profile)) {
    throw new Error(`profile "${profile}" is not one of the known profiles (${KNOWN_PROFILES.join(", ")}).`);
  }
  const state = loadProfileDefaultsDocument();
  if (state.error) {
    throw new Error(`Profile defaults at ${PROFILE_DEFAULTS_SOURCE} are unavailable or invalid: ${state.error.message}`);
  }
  return {
    profile,
    parameters: structuredClone(state.document.profiles[profile]),
    source: PROFILE_DEFAULTS_SOURCE,
  };
}

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
  "accessibility",
  "provenance",
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

// ---------------------------------------------------------------------------
// P0d semantic fields: claims, relations, quantities, source ambiguity.
// Cross-references must resolve against inventory ids; dangling references in
// claims.supported_by and relations.source/target are errors (they would make
// "supported by" and arrow direction unverifiable), while ambiguity items may
// legitimately point at canvas objects outside the inventory and therefore
// only warn.

function collectInventoryIds(document) {
  const ids = new Set();
  if (Array.isArray(document.inventory)) {
    for (const item of document.inventory) {
      if (isPlainObject(item) && typeof item.id === "string" && item.id.trim()) ids.add(item.id);
    }
  }
  return ids;
}

function validateClaims(claims, inventoryIds, errors) {
  const seen = new Set();
  claims.forEach((claim, index) => {
    const label = `claims[${index}]`;
    if (!isPlainObject(claim)) {
      errors.push(`${label} must be an object.`);
      return;
    }
    if (requireNonEmptyString(claim.id, `${label}.id`, errors)) {
      if (seen.has(claim.id)) errors.push(`${label}.id "${claim.id}" is duplicated; claim ids must stay unique.`);
      else seen.add(claim.id);
    }
    requireNonEmptyString(claim.statement, `${label}.statement`, errors);
    if (claim.priority !== undefined && (!Number.isInteger(claim.priority) || claim.priority < 1)) {
      errors.push(`${label}.priority must be a positive integer when present.`);
    }
    if (claim.supported_by !== undefined) {
      if (!Array.isArray(claim.supported_by)) {
        errors.push(`${label}.supported_by must be an array of inventory ids when present.`);
      } else {
        claim.supported_by.forEach((ref, refIndex) => {
          if (!requireNonEmptyString(ref, `${label}.supported_by[${refIndex}]`, errors)) return;
          if (!inventoryIds.has(ref)) {
            errors.push(`${label}.supported_by[${refIndex}] references unknown inventory id "${ref}".`);
          }
        });
      }
    }
    if (claim.status !== undefined) requireNonEmptyString(claim.status, `${label}.status`, errors);
  });
}

function validateRelations(relations, inventoryIds, errors) {
  const seen = new Set();
  relations.forEach((relation, index) => {
    const label = `relations[${index}]`;
    if (!isPlainObject(relation)) {
      errors.push(`${label} must be an object.`);
      return;
    }
    if (requireNonEmptyString(relation.id, `${label}.id`, errors)) {
      if (seen.has(relation.id)) errors.push(`${label}.id "${relation.id}" is duplicated; relation ids must stay unique.`);
      else seen.add(relation.id);
    }
    for (const endpoint of ["source", "target"]) {
      if (requireNonEmptyString(relation[endpoint], `${label}.${endpoint}`, errors) && !inventoryIds.has(relation[endpoint])) {
        errors.push(`${label}.${endpoint} references unknown inventory id "${relation[endpoint]}".`);
      }
    }
    requireNonEmptyString(relation.relation, `${label}.relation`, errors);
  });
}

function validateQuantities(quantities, errors) {
  const seen = new Set();
  quantities.forEach((quantity, index) => {
    const label = `quantities[${index}]`;
    if (!isPlainObject(quantity)) {
      errors.push(`${label} must be an object.`);
      return;
    }
    if (requireNonEmptyString(quantity.id, `${label}.id`, errors)) {
      if (seen.has(quantity.id)) errors.push(`${label}.id "${quantity.id}" is duplicated; quantity ids must stay unique.`);
      else seen.add(quantity.id);
    }
    requireNonEmptyString(quantity.quantity, `${label}.quantity`, errors);
    requireNonEmptyString(quantity.unit, `${label}.unit`, errors);
  });
}

function validateSourceAmbiguities(ambiguities, inventoryIds, errors, warnings) {
  ambiguities.forEach((ambiguity, index) => {
    const label = `source_ambiguities[${index}]`;
    if (!isPlainObject(ambiguity)) {
      errors.push(`${label} must be an object.`);
      return;
    }
    if (!KNOWN_AMBIGUITY_SEVERITIES.includes(ambiguity.severity)) {
      errors.push(`${label}.severity must be one of ${KNOWN_AMBIGUITY_SEVERITIES.join(", ")}.`);
    }
    requireNonEmptyString(ambiguity.question, `${label}.question`, errors);
    if (ambiguity.item !== undefined) {
      if (requireNonEmptyString(ambiguity.item, `${label}.item`, errors) && !inventoryIds.has(ambiguity.item)) {
        warnings.push(
          `${label}.item "${ambiguity.item}" does not match an inventory id; it may reference a canvas object or a free-form target.`
        );
      }
    }
    if (ambiguity.resolution !== undefined && ambiguity.resolution !== null) {
      requireNonEmptyString(ambiguity.resolution, `${label}.resolution`, errors);
    }
  });
}

// P4 reserved blocks. accessibility.alt_text stores the generated figure
// description (drafts come from figure-alt-text.mjs); provenance records the
// source and processing history of raster assets. Detector work that consumes
// provenance is deliberately out of scope for now: the schema must not block
// it later, but nothing here inspects actual images.
function validateAccessibility(value, errors, warnings) {
  if (!isPlainObject(value)) {
    errors.push("accessibility must be an object when present.");
    return;
  }
  if (value.alt_text !== undefined) {
    requireNonEmptyString(value.alt_text, "accessibility.alt_text", errors);
  }
  for (const key of Object.keys(value)) {
    if (key !== "alt_text") {
      warnings.push(`accessibility.${key} is not part of the reserved accessibility block; preserved for forward compatibility.`);
    }
  }
}

function validateProvenance(value, errors, warnings) {
  if (!isPlainObject(value)) {
    errors.push("provenance must be an object when present.");
    return;
  }
  const known = new Set(["source_type", "source_file", "processing", "crop", "license"]);
  if (value.source_type !== undefined) {
    requireNonEmptyString(value.source_type, "provenance.source_type", errors);
  }
  for (const key of ["source_file", "crop", "license"]) {
    if (value[key] !== undefined && value[key] !== null) {
      requireNonEmptyString(value[key], `provenance.${key}`, errors);
    }
  }
  if (value.processing !== undefined) {
    if (!Array.isArray(value.processing)) {
      errors.push("provenance.processing must be an array of strings when present.");
    } else {
      value.processing.forEach((step, index) => {
        requireNonEmptyString(step, `provenance.processing[${index}]`, errors);
      });
    }
  }
  for (const key of Object.keys(value)) {
    if (!known.has(key)) {
      warnings.push(`provenance.${key} is not part of the reserved provenance schema; preserved for forward compatibility.`);
    }
  }
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
  if (document.figure_kind !== undefined) {
    if (typeof document.figure_kind !== "string" || !document.figure_kind.trim()) {
      errors.push("figure_kind must be a non-empty string when present.");
    } else if (!KNOWN_FIGURE_KINDS.includes(document.figure_kind)) {
      warnings.push(
        `figure_kind "${document.figure_kind}" is not one of the known kinds (${KNOWN_FIGURE_KINDS.join(", ")}); preserved for forward compatibility.`
      );
    }
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
  const inventoryIds = collectInventoryIds(document);
  if (Array.isArray(document.claims)) {
    validateClaims(document.claims, inventoryIds, errors);
  }
  if (Array.isArray(document.relations)) {
    validateRelations(document.relations, inventoryIds, errors);
  }
  if (Array.isArray(document.quantities)) {
    validateQuantities(document.quantities, errors);
  }
  if (Array.isArray(document.source_ambiguities)) {
    validateSourceAmbiguities(document.source_ambiguities, inventoryIds, errors, warnings);
  }
  if (isPlainObject(document.acceptance) && document.acceptance.block_on_structural_ambiguity !== undefined) {
    if (typeof document.acceptance.block_on_structural_ambiguity !== "boolean") {
      errors.push("acceptance.block_on_structural_ambiguity must be a boolean when present.");
    }
  }
  if (isPlainObject(document.profile_settings) && typeof document.profile === "string" && KNOWN_PROFILES.includes(document.profile)) {
    const knownKeys = knownProfileParameterKeys(document.profile);
    if (knownKeys) {
      for (const key of Object.keys(document.profile_settings)) {
        if (!knownKeys.has(key)) {
          warnings.push(
            `profile_settings.${key} is not a known parameter for profile "${document.profile}" (${[...knownKeys].join(", ")}); preserved as a project-specific parameter.`
          );
        }
      }
    }
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
  if (document.accessibility !== undefined) {
    validateAccessibility(document.accessibility, errors, warnings);
  }
  if (document.provenance !== undefined) {
    validateProvenance(document.provenance, errors, warnings);
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

// Recreation policy gate (P0d): a pure evaluation of the brief's unresolved
// source ambiguities under the declared recreation_policy. faithful reports
// semantic ambiguity without blocking (reference fidelity wins); publication-
// ready blocks unresolved semantic ambiguity by default and can additionally
// block unresolved structural ambiguity via
// acceptance.block_on_structural_ambiguity. Cosmetic ambiguity and resolved
// entries never block. This does not inspect the canvas; it is the contract
// downstream skills and audits consume.
export function evaluateRecreationGate(document) {
  const policy =
    isPlainObject(document) && typeof document.recreation_policy === "string" ? document.recreation_policy : "unspecified";
  const ambiguities = isPlainObject(document) && Array.isArray(document.source_ambiguities) ? document.source_ambiguities : [];
  const acceptance = isPlainObject(document) && isPlainObject(document.acceptance) ? document.acceptance : null;
  const blockStructural = acceptance?.block_on_structural_ambiguity === true;
  const blocking = [];
  const advisory = [];
  const resolved = [];
  for (const ambiguity of ambiguities) {
    if (!isPlainObject(ambiguity)) continue;
    const entry = {
      item: typeof ambiguity.item === "string" && ambiguity.item.trim() ? ambiguity.item : null,
      severity: typeof ambiguity.severity === "string" ? ambiguity.severity : null,
      question: typeof ambiguity.question === "string" && ambiguity.question.trim() ? ambiguity.question : null,
    };
    const resolution =
      typeof ambiguity.resolution === "string" && ambiguity.resolution.trim() ? ambiguity.resolution.trim() : null;
    if (resolution) {
      resolved.push({ item: entry.item, severity: entry.severity, question: entry.question });
      continue;
    }
    const blocks =
      policy === "publication-ready" &&
      (entry.severity === "semantic" || (entry.severity === "structural" && blockStructural));
    if (blocks) blocking.push(entry);
    else advisory.push(entry);
  }
  return { policy, blocking, advisory, resolved };
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
export function normalizePathArgument(value, name) {
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
export async function resolveFigureDocumentTarget({
  artifactPath,
  explicitPath,
  explicitParamName,
  subject,
  projectSubdirectory = "figures",
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
      target: path.join(projectDirectory, ".scientific-illustrator", projectSubdirectory, projectFileName(stem)),
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
        recreation_gate: evaluateRecreationGate(null),
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
    recreation_gate: evaluateRecreationGate(document),
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
  return {
    resolved_path: target,
    resolution_basis: resolutionBasis,
    revision,
    created,
    schema_warnings: warnings,
    recreation_gate: evaluateRecreationGate(next),
  };
}

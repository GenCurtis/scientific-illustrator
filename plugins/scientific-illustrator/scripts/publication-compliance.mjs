// Publication Compliance layer (P2): publisher spec loading, validation, and
// layered rule resolution.
//
// Design: docs/planning/design-publication-compliance.md
// - machine-readable publisher specs live in references/publishers/<slug>/*.json
//   with a human-readable README.md per adapter;
// - resolution is a single-pass layered last-wins chain:
//     explicit user override > venue spec > publisher spec > profile defaults
//   (system defaults are currently empty);
// - every resolved token carries provenance; comparison semantics
//   ("greater-than" vs "greater-than-or-equal") are preserved, never flattened;
// - unknown values stay unknown: a rule may carry { "unknown": true, "note": ... }
//   and the resolver reports it instead of inventing a number;
// - stale specs are reported with a freshness warning, never silently dropped.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  KNOWN_PROFILES,
  PROFILE_DEFAULTS_SCHEMA_VERSION,
  readProfileDefaults,
} from "./figure-truth.mjs";

export const PUBLISHER_SPEC_SCHEMA_VERSION = "scientific-illustrator/publisher-spec@1";

// First-batch adapters. Keep this list in sync with references/publishers/
// (validate-repo enforces the bidirectional match).
export const KNOWN_PUBLISHERS = ["acm", "elsevier", "ieee", "springer-nature"];

export const KNOWN_COMPARISONS = ["greater-than", "greater-than-or-equal"];

const PUBLISHERS_DIRECTORY = new URL("../references/publishers/", import.meta.url);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Object-prototype keys must never travel through user-supplied override
// tokens; JSON.parse can materialize "__proto__" as an own property.
const RESERVED_TOKEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function assertSafeOverrideTokens(overrides) {
  for (const token of Object.keys(overrides)) {
    const segments = token.split(".");
    if (segments.some((segment) => segment === "")) {
      throw new Error(`overrides token "${token}" contains an empty path segment.`);
    }
    if (segments.some((segment) => RESERVED_TOKEN_SEGMENTS.has(segment))) {
      throw new Error(`overrides token "${token}" uses a reserved object key.`);
    }
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

// ---------------------------------------------------------------------------
// Spec validation
// ---------------------------------------------------------------------------

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function walkRuleNodes(value, path, visit) {
  if (!isPlainObject(value)) return;
  visit(value, path);
  for (const [key, child] of Object.entries(value)) {
    if (isPlainObject(child)) walkRuleNodes(child, path ? `${path}.${key}` : key, visit);
  }
}

function walkRuleKeys(value, path, visit) {
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    visit(key, childPath);
    walkRuleKeys(child, childPath, visit);
  }
}

export function validatePublisherSpec(spec, { slug, file } = {}) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(spec)) {
    errors.push("spec must be a JSON object.");
    return { errors, warnings };
  }
  if (spec.schema !== PUBLISHER_SPEC_SCHEMA_VERSION) {
    errors.push(`schema must be "${PUBLISHER_SPEC_SCHEMA_VERSION}".`);
  }
  if (!isNonEmptyString(spec.id)) {
    errors.push("id must be a non-empty string.");
  } else if (isNonEmptyString(slug) && !spec.id.startsWith(`${slug}-`)) {
    warnings.push(`id "${spec.id}" does not start with the publisher slug "${slug}-".`);
  }
  if (!isNonEmptyString(spec.publisher)) errors.push("publisher must be a non-empty string.");

  if (!isPlainObject(spec.source)) {
    errors.push("source must be an object.");
  } else {
    if (!isNonEmptyString(spec.source.authority)) errors.push("source.authority must be a non-empty string.");
    if (!isNonEmptyString(spec.source.checked_at) || !DATE_PATTERN.test(spec.source.checked_at)) {
      errors.push("source.checked_at must be a valid YYYY-MM-DD calendar date.");
    } else {
      const parsed = Date.parse(`${spec.source.checked_at}T00:00:00Z`);
      if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== spec.source.checked_at) {
        errors.push("source.checked_at must be a valid YYYY-MM-DD calendar date.");
      }
    }
    if (!isNonEmptyString(spec.source.retrieved_by)) errors.push("source.retrieved_by must be a non-empty string.");
    if (!Array.isArray(spec.source.source_urls) || spec.source.source_urls.some((url) => !isNonEmptyString(url))) {
      errors.push("source.source_urls must be an array of non-empty strings.");
    } else if (spec.source.source_urls.length === 0) {
      warnings.push("source.source_urls is empty; provenance for this spec is incomplete.");
    }
  }

  if (!isPlainObject(spec.scope)) {
    errors.push("scope must be an object.");
  } else if (!Array.isArray(spec.scope.profile) || spec.scope.profile.length === 0) {
    errors.push("scope.profile must be a non-empty array.");
  } else {
    for (const profile of spec.scope.profile) {
      if (!KNOWN_PROFILES.includes(profile)) errors.push(`scope.profile contains unknown profile "${profile}".`);
    }
  }

  if (!isPlainObject(spec.rules) || Object.keys(spec.rules).length === 0) {
    errors.push("rules must be a non-empty object.");
  } else {
    walkRuleNodes(spec.rules, "", (node, path) => {
      if (Object.prototype.hasOwnProperty.call(node, "comparison") && !KNOWN_COMPARISONS.includes(node.comparison)) {
        errors.push(`${path || "rules"}.comparison must be one of ${KNOWN_COMPARISONS.join(", ")}.`);
      }
      if (Object.prototype.hasOwnProperty.call(node, "minimum_dpi")) {
        const dpi = node.minimum_dpi;
        if (!Number.isFinite(dpi) || dpi <= 0) errors.push(`${path || "rules"}.minimum_dpi must be a positive number.`);
      }
      if (Object.prototype.hasOwnProperty.call(node, "unknown") && typeof node.unknown !== "boolean") {
        errors.push(`${path || "rules"}.unknown must be a boolean.`);
      }
    });
    walkRuleKeys(spec.rules, "", (key, path) => {
      if (RESERVED_TOKEN_SEGMENTS.has(key)) {
        errors.push(`rules key "${path}" uses a reserved object key.`);
      }
      if (key.includes(".")) {
        warnings.push(`rules key "${path}" contains a literal dot; flattened token paths may collide with nested keys.`);
      }
    });
  }

  if (spec.confidence !== undefined) {
    if (!isPlainObject(spec.confidence) || !isNonEmptyString(spec.confidence.level)) {
      errors.push("confidence, when present, must be an object with a non-empty level.");
    }
  }
  if (!isPlainObject(spec.refresh)) {
    errors.push("refresh must be an object.");
  } else {
    if (!isNonEmptyString(spec.refresh.strategy)) errors.push("refresh.strategy must be a non-empty string.");
    if (!Number.isInteger(spec.refresh.stale_after_days) || spec.refresh.stale_after_days <= 0) {
      errors.push("refresh.stale_after_days must be a positive integer.");
    }
  }

  const knownTopLevel = new Set(["schema", "id", "publisher", "source", "scope", "rules", "confidence", "refresh", "extensions"]);
  for (const key of Object.keys(spec)) {
    if (!knownTopLevel.has(key)) warnings.push(`unknown field "${key}" is preserved but not part of publisher-spec@1.`);
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function loadPublisherSpecs(slug) {
  if (!isNonEmptyString(slug)) throw new Error("publisher must be a non-empty string.");
  const normalized = slug.trim();
  if (!KNOWN_PUBLISHERS.includes(normalized)) {
    throw new Error(`publisher "${normalized}" is not one of the known publishers (${KNOWN_PUBLISHERS.join(", ")}).`);
  }
  const directory = new URL(`${normalized}/`, PUBLISHERS_DIRECTORY);
  let entries;
  try {
    entries = fs.readdirSync(directory);
  } catch {
    throw new Error(`publisher spec directory for "${normalized}" is missing.`);
  }
  const jsonFiles = entries
    .filter((file) => file.endsWith(".json"))
    .sort((left, right) => (left === "baseline.json" ? -1 : right === "baseline.json" ? 1 : left.localeCompare(right)));
  if (!jsonFiles.includes("baseline.json")) {
    throw new Error(`publisher "${normalized}" has no baseline.json.`);
  }
  const specs = [];
  const seenIds = new Set();
  for (const file of jsonFiles) {
    let spec;
    try {
      spec = JSON.parse(fs.readFileSync(new URL(file, directory), "utf8"));
    } catch (error) {
      throw new Error(`publisher spec ${normalized}/${file} is not valid JSON: ${error.message}`);
    }
    const { errors } = validatePublisherSpec(spec, { slug: normalized, file });
    if (errors.length > 0) {
      throw new Error(`publisher spec ${normalized}/${file} is invalid: ${errors.join(" ")}`);
    }
    if (seenIds.has(spec.id)) {
      throw new Error(`publisher "${normalized}" declares duplicate spec id "${spec.id}".`);
    }
    seenIds.add(spec.id);
    specs.push({ file, spec });
  }
  let readme = null;
  try {
    readme = fs.readFileSync(new URL("README.md", directory), "utf8");
  } catch {
    readme = null;
  }
  return { publisher: normalized, directory: fileURLToPath(directory), specs, readme };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function flattenRules(value, prefix, out) {
  if (!isPlainObject(value)) {
    out[prefix] = value;
    return out;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    out[prefix] = {};
    return out;
  }
  for (const [key, child] of entries) {
    flattenRules(child, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

function applyEntries(resolved, overrideLog, entries) {
  for (const [token, entry] of Object.entries(entries)) {
    const previous = Object.prototype.hasOwnProperty.call(resolved, token) ? resolved[token] : undefined;
    if (previous && !sameValue(previous.value, entry.value)) {
      overrideLog.push({
        token,
        previous: { value: previous.value, source: previous.source },
        applied: { value: entry.value, source: entry.source },
      });
    }
    resolved[token] = {
      value: entry.value,
      source: entry.source,
      source_version: entry.source_version ?? null,
      overridden: Boolean(previous),
      ...(previous ? { overridden_from: previous.source } : {}),
    };
  }
}

function applyTokenLayer(resolved, overrideLog, source, sourceVersion, tokens) {
  const entries = {};
  for (const [token, value] of Object.entries(tokens)) {
    entries[token] = { value, source, source_version: sourceVersion };
  }
  applyEntries(resolved, overrideLog, entries);
}

function unwrapProfileDefaults(parameters) {
  const tokens = {};
  for (const [key, entry] of Object.entries(parameters || {})) {
    if (isPlainObject(entry) && Object.prototype.hasOwnProperty.call(entry, "default")) {
      tokens[key] = entry.default;
    }
  }
  return tokens;
}

export function evaluateFreshness(spec, now = new Date()) {
  const checkedAt = Date.parse(`${spec?.source?.checked_at}T00:00:00Z`);
  const staleAfterDays = spec?.refresh?.stale_after_days;
  if (!Number.isFinite(checkedAt) || !Number.isInteger(staleAfterDays) || staleAfterDays <= 0) return null;
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) return null;
  const ageDays = Math.floor((nowMs - checkedAt) / 86_400_000);
  const stale = ageDays > staleAfterDays;
  return {
    spec_id: spec.id,
    checked_at: spec.source.checked_at,
    age_days: ageDays,
    stale_after_days: staleAfterDays,
    stale,
    message: stale
      ? `${spec.id} was last checked ${spec.source.checked_at} (${ageDays} days ago), older than its ${staleAfterDays}-day maintenance window; verify the current guidelines before a strict submission.`
      : null,
  };
}

function collectUnknowns(resolved) {
  const unknowns = [];
  for (const [token, entry] of Object.entries(resolved)) {
    if (token.endsWith(".unknown") && entry.value === true) {
      const base = token.slice(0, -".unknown".length);
      const note = resolved[`${base}.note`];
      unknowns.push({ token: base, note: isNonEmptyString(note?.value) ? note.value : null });
    }
  }
  return unknowns;
}

function selectedSpecsForProfile(loaded, profile) {
  if (!profile) return loaded.specs;
  return loaded.specs.filter(({ spec }) => spec.scope.profile.includes(profile));
}

export function resolvePublisherSpecs({ publisher, profile = null } = {}) {
  if (profile !== null && profile !== undefined && !isNonEmptyString(profile)) {
    throw new Error("profile must be a non-empty string when provided.");
  }
  const normalizedProfile = isNonEmptyString(profile) ? profile.trim() : null;
  if (normalizedProfile && !KNOWN_PROFILES.includes(normalizedProfile)) {
    throw new Error(`profile "${normalizedProfile}" is not one of the known profiles (${KNOWN_PROFILES.join(", ")}).`);
  }
  const loaded = loadPublisherSpecs(publisher);
  const selected = selectedSpecsForProfile(loaded, normalizedProfile);
  const resolved = {};
  const overrides = [];
  const layers = [];
  const warnings = [];
  const freshness = [];
  if (normalizedProfile && selected.length === 0) {
    warnings.push(`publisher "${loaded.publisher}" has no installed spec for profile "${normalizedProfile}".`);
  }
  for (const { spec } of selected) {
    layers.push({ kind: "publisher-spec", id: spec.id, source_version: spec.source.checked_at });
    applyTokenLayer(resolved, overrides, `publisher:${spec.id}`, spec.source.checked_at, flattenRules(spec.rules, "", {}));
    const freshnessEntry = evaluateFreshness(spec);
    if (freshnessEntry) {
      freshness.push(freshnessEntry);
      if (freshnessEntry.stale) warnings.push(freshnessEntry.message);
    }
  }
  return {
    publisher: loaded.publisher,
    profile: normalizedProfile,
    layers,
    resolved,
    overrides,
    unknowns: collectUnknowns(resolved),
    freshness,
    warnings,
  };
}

function composeRuntimeStatement({ publisher, appliedSpecs, venue, staleMessages }) {
  const parts = [];
  if (publisher && appliedSpecs.length > 0) {
    const baseline = appliedSpecs[0].spec;
    parts.push(`Applied ${baseline.publisher} publisher baseline (checked ${baseline.source.checked_at}).`);
    const extras = appliedSpecs.slice(1).map(({ spec }) => spec.id);
    if (extras.length > 0) parts.push(`Additional publisher specs applied: ${extras.join(", ")}.`);
    parts.push("Journal-specific author instructions may override these values.");
  } else if (publisher) {
    parts.push(`No installed publisher spec applies to this profile for "${publisher}".`);
  } else {
    parts.push("No publisher baseline applied; generic profile defaults only.");
  }
  if (venue) {
    parts.push(`No venue-specific override is installed for "${venue}"; the publisher baseline applies.`);
  } else {
    parts.push("No venue-specific override is installed.");
  }
  for (const message of staleMessages) parts.push(message);
  return parts.join(" ");
}

export function resolveFigureRules({
  profile,
  figureKind = null,
  publisher = null,
  venue = null,
  styleId = null,
  overrides = null,
  now = new Date(),
} = {}) {
  if (!isNonEmptyString(profile)) throw new Error("profile must be a non-empty string.");
  const normalizedProfile = profile.trim();
  if (!KNOWN_PROFILES.includes(normalizedProfile)) {
    throw new Error(`profile "${normalizedProfile}" is not one of the known profiles (${KNOWN_PROFILES.join(", ")}).`);
  }
  if (publisher !== null && publisher !== undefined && !isNonEmptyString(publisher)) {
    throw new Error("publisher must be a non-empty string when provided.");
  }
  if (figureKind !== null && figureKind !== undefined && !isNonEmptyString(figureKind)) {
    throw new Error("figure_kind must be a non-empty string when provided.");
  }
  if (venue !== null && venue !== undefined && !isNonEmptyString(venue)) {
    throw new Error("venue must be a non-empty string when provided.");
  }
  if (styleId !== null && styleId !== undefined && !isNonEmptyString(styleId)) {
    throw new Error("style_id must be a non-empty string when provided.");
  }
  const normalizedPublisher = isNonEmptyString(publisher) ? publisher.trim() : null;
  if (normalizedPublisher && !KNOWN_PUBLISHERS.includes(normalizedPublisher)) {
    throw new Error(`publisher "${normalizedPublisher}" is not one of the known publishers (${KNOWN_PUBLISHERS.join(", ")}).`);
  }
  const normalizedVenue = isNonEmptyString(venue) ? venue.trim() : null;
  const normalizedStyleId = isNonEmptyString(styleId) ? styleId.trim() : null;
  if (overrides !== null && overrides !== undefined && !isPlainObject(overrides)) {
    throw new Error("overrides must be a plain object mapping dotted rule tokens to values.");
  }
  if (overrides) assertSafeOverrideTokens(overrides);

  const resolved = {};
  const overrideLog = [];
  const layers = [];
  const warnings = [];

  const defaults = readProfileDefaults(normalizedProfile);
  applyTokenLayer(resolved, overrideLog, `profile-defaults:${normalizedProfile}`, PROFILE_DEFAULTS_SCHEMA_VERSION, unwrapProfileDefaults(defaults.parameters));
  layers.push({ kind: "profile-defaults", id: normalizedProfile, source_version: PROFILE_DEFAULTS_SCHEMA_VERSION });

  const freshness = [];
  let appliedSpecs = [];
  if (normalizedPublisher) {
    const loaded = loadPublisherSpecs(normalizedPublisher);
    appliedSpecs = selectedSpecsForProfile(loaded, normalizedProfile);
    if (appliedSpecs.length === 0) {
      warnings.push(`publisher "${normalizedPublisher}" has no installed spec for profile "${normalizedProfile}".`);
    }
    for (const { spec } of appliedSpecs) {
      layers.push({ kind: "publisher-spec", id: spec.id, source_version: spec.source.checked_at });
      applyTokenLayer(resolved, overrideLog, `publisher:${spec.id}`, spec.source.checked_at, flattenRules(spec.rules, "", {}));
      const freshnessEntry = evaluateFreshness(spec, now);
      if (freshnessEntry) {
        freshness.push(freshnessEntry);
        if (freshnessEntry.stale) warnings.push(freshnessEntry.message);
      }
    }
  }

  const unknowns = [];
  if (normalizedVenue) {
    unknowns.push({ token: "venue", note: `no installed venue adapter for "${normalizedVenue}"; the publisher baseline applies instead` });
    warnings.push(`venue "${normalizedVenue}" has no installed adapter; publisher baseline applied.`);
  }

  if (overrides) {
    applyTokenLayer(resolved, overrideLog, "user-override", null, overrides);
    layers.push({ kind: "user-override", id: "user", source_version: null });
  }

  for (const unknown of collectUnknowns(resolved)) unknowns.push(unknown);

  return {
    context: {
      profile: normalizedProfile,
      figure_kind: isNonEmptyString(figureKind) ? figureKind.trim() : null,
      publisher: normalizedPublisher,
      venue: normalizedVenue,
      style_id: normalizedStyleId,
    },
    layers,
    resolved,
    overrides: overrideLog,
    unknowns,
    freshness,
    warnings,
    runtime_statement: composeRuntimeStatement({
      publisher: normalizedPublisher,
      appliedSpecs,
      venue: normalizedVenue,
      staleMessages: freshness.filter((entry) => entry.stale).map((entry) => entry.message),
    }),
  };
}

export function getPublisherSpecDocument({ publisher, specId = null } = {}) {
  if (specId !== null && specId !== undefined && !isNonEmptyString(specId)) {
    throw new Error("spec_id must be a non-empty string when provided.");
  }
  const loaded = loadPublisherSpecs(publisher);
  let selected = loaded.specs;
  if (isNonEmptyString(specId)) {
    const normalized = specId.trim();
    selected = loaded.specs.filter(({ spec }) => spec.id === normalized);
    if (selected.length === 0) {
      throw new Error(`publisher "${loaded.publisher}" has no spec with id "${normalized}" (available: ${loaded.specs.map(({ spec }) => spec.id).join(", ")}).`);
    }
  }
  return {
    publisher: loaded.publisher,
    directory: loaded.directory,
    readme: loaded.readme,
    specs: selected.map(({ file, spec }) => ({ file, schema: spec.schema, id: spec.id, spec })),
  };
}

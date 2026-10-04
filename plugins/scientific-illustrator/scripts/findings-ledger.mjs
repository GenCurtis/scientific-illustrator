// Findings attribution ledger (P0b): stable finding ids, a persisted baseline,
// and the new/persistent/resolved diff that makes repeated deterministic
// audits attributable instead of noisy.
//
// finding_id = "<rule_id>@<canonical-anchor-set>". The anchor set is the
// sorted unique union of the audit scope ("slide:N"; draw.io uses "page") and
// the stable object references the finding already carries (PowerPoint shape
// names from python/Office.js findings, object name arrays from COM/draw.io
// findings). Findings without any anchor fall back to a short hash of the
// rule id plus the finding evidence so at least one instance stays stable.
//
// The ledger is derived runtime state (gitignored), not figure truth: a
// missing, malformed, or unwritable ledger degrades to "everything is new"
// attribution and never blocks the audit itself.
//
// Concurrency follows the brief's model: MCP requests are serialized inside
// one server process, so read-diff-write is safe there. Two server processes
// sharing one project can still lose one ledger update (accepted limitation,
// same as figure-truth's cross-process optimistic-lock gap). This module is
// not re-entrant: callers must serialize calls that target the same ledger
// (every MCP server does, through its request queue).

import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { assertAllowedRealPath, atomicWrite } from "./guardrails.mjs";
import { readFigureBrief, resolveFindingsTarget } from "./figure-truth.mjs";

export const FINDINGS_SCHEMA_VERSION = "scientific-illustrator/findings@1";

// Cross-backend synonyms collapse to one canonical rule id so switching
// backends (COM / OOXML / Office.js / draw.io) does not churn the ledger.
const RULE_ALIASES = {
  outside_slide: "bounds",
  outside_page: "bounds",
  text_overflow: "text_fit",
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function canonicalRuleId(category) {
  const raw = String(category ?? "").trim().toLowerCase();
  if (!raw) return "unknown";
  const normalized = raw.replace(/[\s-]+/g, "_").replace(/_{2,}/g, "_").replace(/^_+|_+$/g, "");
  return RULE_ALIASES[normalized] || normalized;
}

// Stable object anchors a finding already carries, independent of backend.
function findingAnchors(finding) {
  if (Array.isArray(finding.objects)) {
    return finding.objects.map((value) => String(value ?? "").trim()).filter(Boolean);
  }
  if (typeof finding.shape_name === "string" && finding.shape_name.trim()) {
    return [finding.shape_name.trim()];
  }
  return [];
}

// Adds rule_id/finding_id/anchors to every finding. Kept as a pure function so
// the id scheme is unit-testable without touching the filesystem. Non-object
// entries pass through untouched; no finding is ever required to be well-formed
// for the attribution layer to stay harmless.
const MAX_ANCHORS = 32;

export function deriveFindingIds(findings = [], { scopeAnchor = null } = {}) {
  const list = Array.isArray(findings) ? findings : [];
  return list.map((finding) => {
    if (!isPlainObject(finding)) return finding;
    const ruleId = canonicalRuleId(finding.category ?? finding.rule_id);
    const allObjectAnchors = [...new Set(findingAnchors(finding))].sort();
    const objectAnchors = allObjectAnchors.slice(0, MAX_ANCHORS);
    const anchors = [];
    if (scopeAnchor !== null && scopeAnchor !== undefined && String(scopeAnchor).trim()) {
      anchors.push(String(scopeAnchor).trim());
    }
    anchors.push(...objectAnchors);
    if (allObjectAnchors.length > MAX_ANCHORS) {
      // Fold the discarded anchors into a short digest so two findings that
      // differ only beyond the cap still get distinct ids.
      const digest = createHash("sha256").update(JSON.stringify(allObjectAnchors)).digest("hex").slice(0, 12);
      anchors.push(`more:${digest}`);
    } else if (objectAnchors.length === 0) {
      // No stable object reference: differentiate on the rule plus the
      // evidence text the backend exposes (message when evidence is absent).
      const digest = createHash("sha256")
        .update(`${ruleId}|${String(finding.evidence ?? finding.message ?? "")}`)
        .digest("hex")
        .slice(0, 12);
      anchors.push(`hash:${digest}`);
    }
    return { ...finding, rule_id: ruleId, finding_id: `${ruleId}@${anchors.join("+")}`, anchors };
  });
}

function stripInternal(finding) {
  if (!isPlainObject(finding)) return finding;
  const { anchors, ...rest } = finding;
  return rest;
}

// Human-visible reference for a disposition entry: an explicit id wins, then
// the object item, then the rule id. Never empty so the verdict stays
// traceable back to the brief that declared it.
function dispositionRef(entry) {
  for (const candidate of [entry?.id, entry?.item, entry?.rule_id]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "(unnamed)";
}

// Matches brief-declared dispositions (intentional_deviations, disputes)
// against the current audit's findings:
//   - a dispute applies when approved_by is "user", the canonical rule id
//     matches, the optional item is one of the finding's anchors, and the
//     optional rule_version does not contradict the finding's rule_version;
//   - a deviation applies when its canonical category matches the rule and its
//     item is one of the finding's anchors. integrity findings can never be
//     waived; hard findings additionally require the category in
//     acceptance.waivable_categories plus approved_by "user";
//   - a dispute wins over a waiver when both match.
// Attempted dispositions that hit a boundary are reported in `rejected`
// instead of being silently dropped, so a refused waiver stays visible.
export function matchDispositions(findings = [], { deviations = [], disputes = [], waivableCategories = [] } = {}) {
  const waiverCategories = new Set(
    (Array.isArray(waivableCategories) ? waivableCategories : []).map((value) => canonicalRuleId(value))
  );
  const rejected = [];
  const rejectedKeys = new Set();
  const reject = (kind, ref, reason) => {
    const key = `${kind}|${ref}|${reason}`;
    if (rejectedKeys.has(key)) return;
    rejectedKeys.add(key);
    rejected.push({ kind, ref, reason });
  };
  const matches = (Array.isArray(findings) ? findings : []).map((finding) => {
    if (!isPlainObject(finding)) return null;
    const ruleId = finding.rule_id ?? canonicalRuleId(finding.category);
    const anchors = Array.isArray(finding.anchors) ? finding.anchors : findingAnchors(finding);
    for (const dispute of Array.isArray(disputes) ? disputes : []) {
      if (!isPlainObject(dispute) || canonicalRuleId(dispute.rule_id) !== ruleId) continue;
      if (dispute.item !== undefined && !anchors.includes(String(dispute.item))) continue;
      const ref = dispositionRef(dispute);
      const findingVersion = typeof finding.rule_version === "string" ? finding.rule_version : null;
      if (findingVersion !== null && typeof dispute.rule_version === "string" && dispute.rule_version !== findingVersion) {
        reject("dispute", ref, "rule_version_changed");
        continue;
      }
      if (dispute.approved_by !== "user") {
        reject("dispute", ref, "requires_user_approval");
        continue;
      }
      return { type: "disputed", ref };
    }
    for (const deviation of Array.isArray(deviations) ? deviations : []) {
      if (!isPlainObject(deviation) || canonicalRuleId(deviation.category) !== ruleId) continue;
      if (!anchors.includes(String(deviation.item))) continue;
      const ref = dispositionRef(deviation);
      if (finding.severity === "integrity") {
        reject("waiver", ref, "integrity_not_waivable");
        continue;
      }
      if (finding.severity === "hard" && !waiverCategories.has(ruleId)) {
        reject("waiver", ref, "category_not_in_waivable_list");
        continue;
      }
      if (finding.severity === "hard" && deviation.approved_by !== "user") {
        reject("waiver", ref, "requires_user_approval");
        continue;
      }
      return { type: "waived", ref };
    }
    return null;
  });
  return { matches, rejected };
}

function statusBlockFor(match, baseStatus) {
  if (match?.type === "disputed") return { status: "disputed", dispute_ref: match.ref };
  if (match?.type === "waived") return { status: "waived", waive_ref: match.ref };
  return { status: baseStatus };
}

function buildBriefBlock(briefApplied, matches, rejected) {
  if (!briefApplied) return null;
  if (!briefApplied.applied) return { ...briefApplied };
  const refsFor = (type) => [...new Set(matches.filter((match) => match?.type === type).map((match) => match.ref))];
  return {
    ...briefApplied,
    waivers_used: refsFor("waived"),
    disputes_used: refsFor("disputed"),
    ...(rejected.length ? { rejected } : {}),
  };
}

function summarize(findings, resolvedCount) {
  let integrity = 0;
  let hard = 0;
  let warning = 0;
  let info = 0;
  let created = 0;
  let persistent = 0;
  let waived = 0;
  let disputed = 0;
  for (const finding of findings) {
    if (!isPlainObject(finding)) continue;
    if (finding.severity === "integrity") integrity += 1;
    else if (finding.severity === "hard") hard += 1;
    else if (finding.severity === "warning") warning += 1;
    else if (finding.severity === "info") info += 1;
    if (finding.status === "new") created += 1;
    else if (finding.status === "persistent") persistent += 1;
    else if (finding.status === "waived") waived += 1;
    else if (finding.status === "disputed") disputed += 1;
  }
  return { integrity, hard, warning, info, new: created, persistent, resolved: resolvedCount, waived, disputed };
}

// Diffs the current findings against the ledger baseline for one scope,
// applies brief-declared dispositions (waivers and disputes), updates the
// ledger atomically, and returns annotated findings plus the summary.
// Findings statuses:
//   "new"        - no prior record in the baseline for this scope;
//   "persistent" - recorded by the previous audit of the same scope;
//   "waived"     - matched an intentional_deviations entry (visible, non-blocking);
//   "disputed"   - matched a user-approved dispute (visible, non-blocking).
// Dispositions apply before the baseline diff, and waived/disputed findings
// are still recorded in the ledger, so removing the declaration restores
// "persistent" on the next audit instead of "new".
// resolved_findings carries ids recorded by the previous audit that are gone
// now (informational, used to confirm fixes).
export async function applyFindingsLedger({
  artifactPath = null,
  findingsPath,
  findings,
  scopeAnchor = "default",
  revision = null,
  deviations = [],
  disputes = [],
  waivableCategories = [],
  briefApplied = null,
  now = new Date().toISOString(),
} = {}) {
  const scopeKey =
    scopeAnchor === null || scopeAnchor === undefined || String(scopeAnchor).trim() === ""
      ? "default"
      : String(scopeAnchor).trim();
  const idScope = scopeKey === "default" ? null : scopeKey;
  const annotated = deriveFindingIds(findings, { scopeAnchor: idScope });
  const { matches, rejected } = matchDispositions(annotated, { deviations, disputes, waivableCategories });
  const briefBlock = buildBriefBlock(briefApplied, matches, rejected);

  if (!artifactPath && !findingsPath) {
    const withStatus = annotated.map((finding, index) =>
      isPlainObject(finding) ? { ...finding, ...statusBlockFor(matches[index], "new") } : finding
    );
    return {
      findings: withStatus.map(stripInternal),
      resolved_findings: [],
      summary: summarize(withStatus, 0),
      ...(briefBlock ? { brief_applied: briefBlock } : {}),
      ledger_applied: {
        applied: false,
        reason: "no artifact_path or findings_path was provided; attribution ran without a persisted baseline.",
      },
    };
  }

  const { target, resolutionBasis } = await resolveFindingsTarget({ artifactPath, findingsPath });
  const allowedTarget = await assertAllowedRealPath(target);

  let raw = null;
  try {
    raw = await fs.readFile(allowedTarget, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  let previous = null;
  let resetReason = null;
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw);
      if (
        isPlainObject(parsed) &&
        parsed.schema === FINDINGS_SCHEMA_VERSION &&
        Array.isArray(parsed.entries) &&
        isPlainObject(parsed.last_audits)
      ) {
        previous = parsed;
      } else {
        resetReason = "the existing ledger is not a findings@1 document; it was rebuilt from this audit.";
      }
    } catch {
      resetReason = "the existing ledger was not valid JSON; it was rebuilt from this audit.";
    }
  }

  const scopeLastAudit = previous?.last_audits?.[scopeKey];
  const previousIds = scopeLastAudit && Array.isArray(scopeLastAudit.finding_ids) ? scopeLastAudit.finding_ids : null;
  const previousSet = new Set(previousIds || []);
  const currentSet = new Set(annotated.filter(isPlainObject).map((finding) => finding.finding_id));
  const withStatus = annotated.map((finding, index) =>
    isPlainObject(finding)
      ? {
          ...finding,
          ...statusBlockFor(
            matches[index],
            previousIds !== null && previousSet.has(finding.finding_id) ? "persistent" : "new"
          ),
        }
      : finding
  );

  const previousEntries = new Map(
    previous && Array.isArray(previous.entries)
      ? previous.entries.filter(isPlainObject).map((entry) => [entry.finding_id, entry])
      : []
  );
  const currentEntries = withStatus
    .filter(isPlainObject)
    .map((finding) => ({
      finding_id: finding.finding_id,
      rule_id: finding.rule_id,
      category: finding.category ?? null,
      severity: finding.severity ?? null,
      scope: scopeKey,
      anchors: finding.anchors,
      first_seen: previousEntries.get(finding.finding_id)?.first_seen || now,
      last_seen: now,
    }));
  const keptForeignEntries =
    previous?.entries?.filter(
      (entry) =>
        isPlainObject(entry) &&
        typeof entry.finding_id === "string" &&
        entry.finding_id !== "" &&
        entry.scope !== scopeKey &&
        !currentSet.has(entry.finding_id)
    ) || [];
  const resolved =
    previousIds === null
      ? []
      : previousIds
          .filter((id) => !currentSet.has(id))
          .map((id) => {
            const entry = previousEntries.get(id) || {};
            return {
              finding_id: id,
              rule_id: entry.rule_id ?? null,
              category: entry.category ?? null,
              severity: entry.severity ?? null,
              scope: scopeKey,
              last_seen: entry.last_seen ?? null,
            };
          });

  // One entry per finding id; identical ids in one audit collapse to the last
  // instance (its severity/category win for the recorded entry).
  const deduplicatedCurrentEntries = [...new Map(currentEntries.map((entry) => [entry.finding_id, entry])).values()];
  const ledger = {
    schema: FINDINGS_SCHEMA_VERSION,
    artifact_path: artifactPath ? String(artifactPath) : null,
    updated_at: now,
    entries: [...keptForeignEntries, ...deduplicatedCurrentEntries],
    last_audits: {
      ...(previous?.last_audits || {}),
      [scopeKey]: { at: now, revision, finding_ids: [...currentSet] },
    },
  };
  await atomicWrite(target, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

  return {
    findings: withStatus.map(stripInternal),
    resolved_findings: resolved,
    summary: summarize(withStatus, resolved.length),
    ...(briefBlock ? { brief_applied: briefBlock } : {}),
    ledger_applied: {
      applied: true,
      path: target,
      resolution_basis: resolutionBasis,
      scope: scopeKey,
      baseline: previousIds === null ? "none" : "previous_audit",
      ...(resetReason ? { reset_reason: resetReason } : {}),
    },
  };
}

// Attaches the ledger result and the brief-declared dispositions to a whole
// audit tool result. Ledger and brief problems degrade to id-annotated
// findings (new/waived/disputed where the brief still allows it) instead of
// failing the audit: attribution and waiver visibility are evidence tooling,
// never a gate on the review itself.
export async function annotateAuditResult(
  result,
  { artifactPath = null, findingsPath, briefPath, scopeAnchor = "default", revision = null } = {}
) {
  if (!isPlainObject(result)) return result;
  // Callers may forward empty strings from optional MCP arguments; treat them
  // as "not provided" so discovery still runs instead of failing the brief
  // read on a strict path validation.
  const normalizedArtifactPath = typeof artifactPath === "string" && artifactPath.trim() ? artifactPath.trim() : null;
  const normalizedBriefPath = typeof briefPath === "string" && briefPath.trim() ? briefPath.trim() : null;
  const rawFindings = Array.isArray(result.findings) ? result.findings : [];
  let dispositionConfig = { deviations: [], disputes: [], waivableCategories: [] };
  let briefApplied = null;
  if (normalizedArtifactPath || normalizedBriefPath) {
    try {
      const brief = await readFigureBrief({ artifactPath: normalizedArtifactPath, briefPath: normalizedBriefPath });
      if (brief.exists) {
        const document = brief.document || {};
        dispositionConfig = {
          deviations: Array.isArray(document.intentional_deviations) ? document.intentional_deviations : [],
          disputes: Array.isArray(document.disputes) ? document.disputes : [],
          waivableCategories: isPlainObject(document.acceptance) && Array.isArray(document.acceptance.waivable_categories)
            ? document.acceptance.waivable_categories
            : [],
        };
        briefApplied = { applied: true, path: brief.resolved_path, revision: brief.revision };
      } else {
        briefApplied = { applied: false, reason: "no brief was found for this artifact; no waivers or disputes were applied." };
      }
    } catch (error) {
      briefApplied = { applied: false, reason: String(error?.message || error) };
    }
  } else {
    briefApplied = { applied: false, reason: "no artifact_path or brief_path was provided; no waivers or disputes were applied." };
  }
  try {
    const applied = await applyFindingsLedger({
      artifactPath: normalizedArtifactPath,
      findingsPath,
      findings: rawFindings,
      scopeAnchor,
      revision,
      ...dispositionConfig,
      briefApplied,
    });
    result.findings = applied.findings;
    result.resolved_findings = applied.resolved_findings;
    result.summary = applied.summary;
    if (applied.brief_applied) result.brief_applied = applied.brief_applied;
    result.ledger_applied = applied.ledger_applied;
  } catch (error) {
    const annotated = deriveFindingIds(rawFindings, {
      scopeAnchor: scopeAnchor === null || scopeAnchor === undefined || String(scopeAnchor).trim() === "" ? null : String(scopeAnchor).trim(),
    });
    const { matches, rejected } = matchDispositions(annotated, dispositionConfig);
    result.findings = annotated.map((finding, index) =>
      isPlainObject(finding) ? { ...stripInternal(finding), ...statusBlockFor(matches[index], "new") } : finding
    );
    result.resolved_findings = [];
    result.summary = summarize(result.findings, 0);
    const briefBlock = buildBriefBlock(briefApplied, matches, rejected);
    if (briefBlock) result.brief_applied = briefBlock;
    result.ledger_applied = { applied: false, reason: String(error?.message || error) };
  }
  return result;
}

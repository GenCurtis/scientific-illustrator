// Verifies findings disposition (P0c): brief-declared intentional_deviations
// become visible waived statuses, user-approved disputes become disputed
// statuses, boundary rules stay honest (integrity is never waivable, hard
// waivers need the acceptance allowlist plus user approval), and removing a
// declaration restores persistent instead of new. The end-to-end section runs
// against the OOXML backend with application sync disabled, so it needs no
// office application installed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  annotateAuditResult,
  applyFindingsLedger,
  matchDispositions,
} from "../plugins/scientific-illustrator/scripts/findings-ledger.mjs";
import {
  BRIEF_SCHEMA_VERSION,
  validateBrief,
  writeFigureBrief,
} from "../plugins/scientific-illustrator/scripts/figure-truth.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sci-illu-disposition-"));
let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok - ${name}`);
}

function makeBrief(overrides = {}) {
  return {
    schema: BRIEF_SCHEMA_VERSION,
    figure_id: "flow-figure",
    profile: "paper-figure",
    inventory: [],
    ...overrides,
  };
}

const finding = {
  category: "large_raster_surface",
  severity: "warning",
  shape_name: "Micrograph2",
  finding_id: "large_raster_surface@slide:1+Micrograph2",
  anchors: ["slide:1", "Micrograph2"],
};
const deviation = { item: "Micrograph2", category: "large_raster_surface", reason: "micrograph" };

try {
  // ------------------------------------------------- disposition matching
  await check("a warning deviation waives by rule and anchor", async () => {
    const { matches, rejected } = matchDispositions([finding], { deviations: [deviation] });
    assert.deepEqual(matches[0], { type: "waived", ref: "Micrograph2" });
    assert.deepEqual(rejected, []);
  });

  await check("deviations canonicalize cross-backend category synonyms", async () => {
    const raw = [{ category: "outside-slide", severity: "warning", objects: ["A"] }];
    const { matches } = matchDispositions(raw, {
      deviations: [{ item: "A", category: "outside_page", reason: "outside page is intended" }],
    });
    assert.deepEqual(matches[0], { type: "waived", ref: "A" });
  });

  await check("a deviation whose item is not an anchor is ignored", async () => {
    const { matches, rejected } = matchDispositions([finding], {
      deviations: [{ item: "Other", category: "large_raster_surface", reason: "x" }],
    });
    assert.equal(matches[0], null);
    assert.deepEqual(rejected, []);
  });

  await check("ref selection skips non-string ids and falls back to the item", async () => {
    const { matches } = matchDispositions([finding], {
      deviations: [{ id: 5, item: "Micrograph2", category: "large_raster_surface", reason: "x" }],
    });
    assert.deepEqual(matches[0], { type: "waived", ref: "Micrograph2" });
  });

  await check("integrity findings can never be waived", async () => {
    const integrity = { ...finding, severity: "integrity" };
    const { matches, rejected } = matchDispositions([integrity], {
      deviations: [deviation],
      waivableCategories: ["large_raster_surface"],
    });
    assert.equal(matches[0], null);
    assert.deepEqual(rejected, [{ kind: "waiver", ref: "Micrograph2", reason: "integrity_not_waivable" }]);
  });

  await check("hard findings need the category in the waivable allowlist", async () => {
    const hard = { ...finding, severity: "hard" };
    const { matches, rejected } = matchDispositions([hard], { deviations: [deviation] });
    assert.equal(matches[0], null);
    assert.deepEqual(rejected, [{ kind: "waiver", ref: "Micrograph2", reason: "category_not_in_waivable_list" }]);
  });

  await check("hard waivers with the category still require user approval", async () => {
    const hard = { ...finding, severity: "hard" };
    const { matches, rejected } = matchDispositions([hard], {
      deviations: [{ ...deviation, approved_by: "agent-with-user-ack" }],
      waivableCategories: ["large_raster_surface"],
    });
    assert.equal(matches[0], null);
    assert.deepEqual(rejected, [{ kind: "waiver", ref: "Micrograph2", reason: "requires_user_approval" }]);
  });

  await check("hard waivers pass with allowlist plus user approval", async () => {
    const hard = { ...finding, severity: "hard" };
    const { matches, rejected } = matchDispositions([hard], {
      deviations: [{ ...deviation, approved_by: "user" }],
      waivableCategories: ["large_raster_surface"],
    });
    assert.deepEqual(matches[0], { type: "waived", ref: "Micrograph2" });
    assert.deepEqual(rejected, []);
  });

  await check("user-approved disputes apply to a matching rule", async () => {
    const { matches } = matchDispositions([finding], {
      disputes: [{ rule_id: "large_raster_surface", reason: "rule false positive", approved_by: "user", id: "d1" }],
    });
    assert.deepEqual(matches[0], { type: "disputed", ref: "d1" });
  });

  await check("disputes without user approval are rejected", async () => {
    const { matches, rejected } = matchDispositions([finding], {
      disputes: [{ rule_id: "large_raster_surface", reason: "x", approved_by: "agent-with-user-ack", id: "d2" }],
    });
    assert.equal(matches[0], null);
    assert.deepEqual(rejected, [{ kind: "dispute", ref: "d2", reason: "requires_user_approval" }]);
  });

  await check("disputes can narrow to one object anchor", async () => {
    const other = { ...finding, finding_id: "large_raster_surface@slide:1+Other", anchors: ["slide:1", "Other"] };
    const { matches } = matchDispositions([finding, other], {
      disputes: [{ rule_id: "large_raster_surface", item: "Micrograph2", reason: "x", approved_by: "user" }],
    });
    assert.equal(matches[0].type, "disputed");
    assert.equal(matches[1], null);
  });

  await check("a dispute wins over a waiver when both match", async () => {
    const { matches, rejected } = matchDispositions([finding], {
      deviations: [deviation],
      disputes: [{ rule_id: "large_raster_surface", reason: "x", approved_by: "user" }],
    });
    assert.equal(matches[0].type, "disputed");
    assert.deepEqual(rejected, []);
  });

  await check("a changed rule version invalidates a dispute for re-evaluation", async () => {
    const versioned = { ...finding, rule_version: "2" };
    const { matches, rejected } = matchDispositions([versioned], {
      disputes: [{ rule_id: "large_raster_surface", reason: "x", approved_by: "user", rule_version: "1", id: "d3" }],
    });
    assert.equal(matches[0], null);
    assert.deepEqual(rejected, [{ kind: "dispute", ref: "d3", reason: "rule_version_changed" }]);
  });

  // ---------------------------------------- ledger integration with waivers
  const flowDir = path.join(tempRoot, "flow");
  const flowArtifact = path.join(flowDir, "fig.pptx");
  await fs.mkdir(flowDir, { recursive: true });
  const flowFinding = { category: "large_raster_surface", severity: "warning", shape_name: "M2" };
  const flowDeviation = { item: "M2", category: "large_raster_surface", reason: "micrograph" };

  await check("waived findings are attributed and recorded in the baseline", async () => {
    const first = await applyFindingsLedger({
      artifactPath: flowArtifact,
      findings: [flowFinding],
      scopeAnchor: "slide:1",
      deviations: [flowDeviation],
      briefApplied: { applied: true, path: path.join(flowDir, "fig.si-brief.json"), revision: 3 },
    });
    assert.equal(first.findings[0].status, "waived");
    assert.equal(first.findings[0].waive_ref, "M2");
    assert.equal(first.summary.waived, 1);
    assert.equal(first.summary.warning, 1);
    assert.equal(first.brief_applied.applied, true);
    assert.deepEqual(first.brief_applied.waivers_used, ["M2"]);
    assert.equal(first.findings[0].anchors, undefined, "internal anchors must not leak");
    const stored = JSON.parse(await fs.readFile(path.join(flowDir, "fig.si-findings.json"), "utf8"));
    assert.deepEqual(stored.last_audits["slide:1"].finding_ids, ["large_raster_surface@slide:1+M2"]);
  });

  await check("removing the waiver restores persistent instead of new", async () => {
    const second = await applyFindingsLedger({
      artifactPath: flowArtifact,
      findings: [flowFinding],
      scopeAnchor: "slide:1",
      briefApplied: { applied: true, path: path.join(flowDir, "fig.si-brief.json"), revision: 4 },
    });
    assert.equal(second.findings[0].status, "persistent");
    assert.equal(second.summary.waived, 0);
    assert.deepEqual(second.brief_applied.waivers_used, []);
    assert.equal("rejected" in second.brief_applied, false, "rejected appears only when something was rejected");
  });

  await check("refused waivers stay visible in brief_applied.rejected", async () => {
    const hardFinding = { category: "bounds", severity: "hard", shape_name: "Box1" };
    const third = await applyFindingsLedger({
      artifactPath: flowArtifact,
      findings: [hardFinding],
      scopeAnchor: "slide:1",
      deviations: [{ item: "Box1", category: "bounds", reason: "slightly out" }],
      briefApplied: { applied: true, path: path.join(flowDir, "fig.si-brief.json"), revision: 5 },
    });
    assert.equal(third.findings[0].status, "new");
    assert.equal(third.summary.waived, 0);
    assert.deepEqual(third.brief_applied.rejected, [
      { kind: "waiver", ref: "Box1", reason: "category_not_in_waivable_list" },
    ]);
  });

  await check("rejected entries and used refs are deduplicated", async () => {
    const rejectedResult = await applyFindingsLedger({
      artifactPath: flowArtifact,
      findings: [
        { category: "bounds", severity: "hard", objects: ["A1", "X"] },
        { category: "bounds", severity: "hard", objects: ["A1", "Y"] },
      ],
      scopeAnchor: "slide:2",
      deviations: [{ item: "A1", category: "bounds", reason: "slightly out" }],
      briefApplied: { applied: true, path: path.join(flowDir, "fig.si-brief.json"), revision: 6 },
    });
    assert.deepEqual(rejectedResult.brief_applied.rejected, [
      { kind: "waiver", ref: "A1", reason: "category_not_in_waivable_list" },
    ]);
    const usedResult = await applyFindingsLedger({
      artifactPath: flowArtifact,
      findings: [
        { category: "large_raster_surface", severity: "warning", objects: ["M3", "X"] },
        { category: "large_raster_surface", severity: "warning", objects: ["M3", "Y"] },
      ],
      scopeAnchor: "slide:2",
      deviations: [{ item: "M3", category: "large_raster_surface", reason: "micrograph" }],
      briefApplied: { applied: true, path: path.join(flowDir, "fig.si-brief.json"), revision: 7 },
    });
    assert.deepEqual(usedResult.brief_applied.waivers_used, ["M3"]);
    assert.equal(usedResult.findings.every((finding) => finding.status === "waived"), true);
  });

  // ------------------------------------------- annotate + real brief files
  const realDir = path.join(tempRoot, "real");
  const realArtifact = path.join(realDir, "deck.pptx");
  await fs.mkdir(realDir, { recursive: true });

  await check("annotate reads the sibling brief and applies its deviations", async () => {
    const written = await writeFigureBrief({
      artifactPath: realArtifact,
      document: makeBrief({
        intentional_deviations: [{ item: "M2", category: "large_raster_surface", reason: "micrograph" }],
      }),
    });
    assert.equal(written.resolved_path, path.join(realDir, "deck.si-brief.json"));
    const result = await annotateAuditResult(
      { findings: [{ category: "large_raster_surface", severity: "warning", shape_name: "M2" }] },
      { artifactPath: realArtifact, scopeAnchor: "slide:1" }
    );
    assert.equal(result.brief_applied.applied, true);
    assert.equal(result.brief_applied.path, written.resolved_path);
    assert.equal(result.brief_applied.revision, 0);
    assert.deepEqual(result.brief_applied.waivers_used, ["M2"]);
    assert.equal(result.findings[0].status, "waived");
    assert.equal(result.ledger_applied.applied, true);
  });

  await check("annotate degrades on an invalid brief without failing the audit", async () => {
    const brokenDir = path.join(tempRoot, "broken");
    const brokenArtifact = path.join(brokenDir, "deck.pptx");
    await fs.mkdir(brokenDir, { recursive: true });
    await fs.writeFile(path.join(brokenDir, "deck.si-brief.json"), "{ not json", "utf8");
    const result = await annotateAuditResult(
      { findings: [{ category: "large_raster_surface", severity: "warning", shape_name: "M2" }] },
      { artifactPath: brokenArtifact, scopeAnchor: "slide:1" }
    );
    assert.equal(result.brief_applied.applied, false);
    assert.match(result.brief_applied.reason, /not valid JSON/i);
    assert.equal(result.findings[0].status, "new");
    assert.equal(result.ledger_applied.applied, true);
  });

  await check("annotate reports a missing brief", async () => {
    const missingDir = path.join(tempRoot, "missing");
    await fs.mkdir(missingDir, { recursive: true });
    const result = await annotateAuditResult(
      { findings: [flowFinding] },
      { artifactPath: path.join(missingDir, "deck.pptx"), scopeAnchor: "slide:1" }
    );
    assert.equal(result.brief_applied.applied, false);
    assert.match(result.brief_applied.reason, /no brief was found/i);
    assert.equal(result.findings[0].status, "new");
  });

  await check("annotate tolerates null results and whitespace-only paths", async () => {
    assert.equal(await annotateAuditResult(null, { artifactPath: realArtifact }), null);
    const result = await annotateAuditResult(
      { findings: [{ category: "large_raster_surface", severity: "warning", shape_name: "M2" }] },
      { artifactPath: realArtifact, briefPath: "   ", scopeAnchor: "slide:1" }
    );
    assert.equal(result.brief_applied.applied, true);
    assert.equal(result.findings[0].status, "waived");
    const viaExplicitBrief = await annotateAuditResult(
      { findings: [{ category: "large_raster_surface", severity: "warning", shape_name: "M2" }] },
      { artifactPath: "   ", briefPath: path.join(realDir, "deck.si-brief.json"), scopeAnchor: "slide:1" }
    );
    assert.equal(viaExplicitBrief.brief_applied.applied, true, "a whitespace artifact_path must not break explicit brief loading");
    assert.equal(viaExplicitBrief.findings[0].status, "waived");
  });

  await check("a ledger failure still surfaces brief waivers on the findings", async () => {
    const previousRoot = process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT;
    try {
      const allowedDir = path.join(tempRoot, "allowed-brief");
      const allowedArtifact = path.join(allowedDir, "fig.pptx");
      await fs.mkdir(allowedDir, { recursive: true });
      await writeFigureBrief({
        artifactPath: allowedArtifact,
        document: makeBrief({
          intentional_deviations: [{ item: "M2", category: "large_raster_surface", reason: "micrograph" }],
        }),
      });
      process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT = allowedDir;
      const result = await annotateAuditResult(
        { findings: [{ category: "large_raster_surface", severity: "warning", shape_name: "M2" }] },
        {
          artifactPath: allowedArtifact,
          findingsPath: path.join(tempRoot, "outside-anywhere", "fig.si-findings.json"),
          scopeAnchor: "slide:1",
        }
      );
      assert.equal(result.ledger_applied.applied, false);
      assert.match(result.ledger_applied.reason, /ALLOWED_ROOT/);
      assert.equal(result.brief_applied.applied, true);
      assert.deepEqual(result.brief_applied.waivers_used, ["M2"]);
      assert.equal(result.findings[0].status, "waived");
      assert.equal(result.summary.waived, 1);
    } finally {
      if (previousRoot === undefined) delete process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT;
      else process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT = previousRoot;
    }
  });

  // --------------------------------------------------- brief validation
  await check("valid deviations, disputes, and allowlist pass validation", async () => {
    const { errors, warnings } = validateBrief(
      makeBrief({
        intentional_deviations: [{ item: "M2", category: "large_raster_surface", reason: "micrograph", approved_by: "user" }],
        disputes: [{ rule_id: "bounds", reason: "known false positive", approved_by: "user" }],
        acceptance: { waivable_categories: ["bounds"] },
      })
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  await check("deviations need item, category, and reason", async () => {
    const base = { item: "M2", category: "bounds", reason: "x" };
    assert.match(validateBrief(makeBrief({ intentional_deviations: [{ ...base, reason: "" }] })).errors.join("\n"), /intentional_deviations\[0\]\.reason/);
    assert.match(validateBrief(makeBrief({ intentional_deviations: [{ ...base, item: "" }] })).errors.join("\n"), /intentional_deviations\[0\]\.item/);
    assert.match(validateBrief(makeBrief({ intentional_deviations: [{ ...base, category: null }] })).errors.join("\n"), /intentional_deviations\[0\]\.category/);
  });

  await check("deviations reject unknown approval vocabulary", async () => {
    const { errors } = validateBrief(
      makeBrief({ intentional_deviations: [{ item: "M2", category: "bounds", reason: "x", approved_by: "self" }] })
    );
    assert.match(errors.join("\n"), /approved_by/);
  });

  await check("disputes need rule_id, reason, and an explicit approval", async () => {
    const valid = { rule_id: "bounds", reason: "x", approved_by: "user" };
    assert.deepEqual(validateBrief(makeBrief({ disputes: [valid] })).errors, []);
    assert.match(validateBrief(makeBrief({ disputes: [{ ...valid, rule_id: "" }] })).errors.join("\n"), /disputes\[0\]\.rule_id/);
    assert.match(validateBrief(makeBrief({ disputes: [{ ...valid, reason: "" }] })).errors.join("\n"), /disputes\[0\]\.reason/);
    const noApproval = { rule_id: "bounds", reason: "x" };
    assert.match(validateBrief(makeBrief({ disputes: [noApproval] })).errors.join("\n"), /disputes\[0\]\.approved_by/);
  });

  await check("acceptance.waivable_categories must be a list of strings", async () => {
    assert.match(
      validateBrief(makeBrief({ acceptance: { waivable_categories: "bounds" } })).errors.join("\n"),
      /waivable_categories must be an array/
    );
    assert.match(
      validateBrief(makeBrief({ acceptance: { waivable_categories: ["bounds", ""] } })).errors.join("\n"),
      /waivable_categories\[1\]/
    );
  });

  await check("extensions stay silent while unknown fields warn", async () => {
    const silent = validateBrief(makeBrief({ extensions: { waivable_cat: ["bounds"] } }));
    assert.deepEqual(silent.warnings, []);
    const noisy = validateBrief(makeBrief({ waivable_cat: ["bounds"] }));
    assert.match(noisy.warnings.join("\n"), /Unknown field "waivable_cat"/);
  });

  // -------------------------------- end-to-end through the MCP audit tool
  await check("drawio audit surface documents brief_path and waived statuses", async () => {
    const source = await fs.readFile(path.join(root, "plugins/scientific-illustrator/scripts/live-server.mjs"), "utf8");
    assert.ok(source.includes('name: "drawio_live_audit_figure"'), "drawio audit tool missing");
    assert.ok(source.includes('brief_path: { type: "string"'), "drawio audit must accept brief_path");
    assert.match(source, /waived\/disputed statuses/, "drawio audit description must document disposed statuses");
  });

  const stateDir = path.join(tempRoot, "state");
  await fs.mkdir(stateDir, { recursive: true });
  const child = spawn(process.execPath, [path.join(root, "plugins/scientific-illustrator/scripts/powerpoint-server.mjs")], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      SCIENTIFIC_ILLUSTRATOR_PPT_HOST: "wps",
      SCIENTIFIC_ILLUSTRATOR_PPT_BACKEND: "ooxml",
      SCIENTIFIC_ILLUSTRATOR_POWERPOINT_SYNC: "0",
      SCIENTIFIC_ILLUSTRATOR_STATE_DIR: stateDir,
    },
  });
  const lines = createInterface({ input: child.stdout });
  let stderr = "";
  let nextId = 0;
  const pending = new Map();
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    entry.resolve(message.result);
  });
  async function request(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`timeout ${method}: ${stderr}`));
      }, 120000).unref();
    });
  }
  async function call(name, args = {}) {
    const result = await request("tools/call", { name, arguments: args });
    if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content).slice(0, 300)}`);
    return result.structuredContent;
  }

  try {
    const e2eDir = path.join(tempRoot, "e2e");
    const e2eArtifact = path.join(e2eDir, "deck.pptx");
    await fs.mkdir(e2eDir, { recursive: true });

    await check("the audit tool surface exposes brief_path", async () => {
      const tools = await request("tools/list");
      const audit = tools.tools.find((tool) => tool.name === "powerpoint_audit_figure");
      assert.ok(audit.inputSchema.properties.brief_path, "powerpoint_audit_figure must accept brief_path");
      assert.match(audit.description, /waived/i, "the audit description must document waived statuses");
    });

    await check("MCP audit waives a hard finding via brief allowlist plus user approval", async () => {
      await call("powerpoint_new_presentation", {});
      await call("powerpoint_add_shape", {
        slide_index: 1,
        name: "disp-bounds",
        shape: "rectangle",
        left: 50000,
        top: 10,
        width: 40,
        height: 20,
      });
      await writeFigureBrief({
        artifactPath: e2eArtifact,
        document: makeBrief({
          intentional_deviations: [{ item: "disp-bounds", category: "bounds", reason: "known geometry deviation", approved_by: "user" }],
          acceptance: { waivable_categories: ["bounds"] },
        }),
      });
      const audit = await call("powerpoint_audit_figure", { slide_index: 1, artifact_path: e2eArtifact });
      const target = audit.findings.find((item) => item.finding_id === "bounds@slide:1+disp-bounds");
      assert.ok(target, `expected the bounds finding among ${JSON.stringify(audit.findings.map((item) => item.finding_id))}`);
      assert.equal(target.status, "waived");
      assert.equal(target.waive_ref, "disp-bounds");
      assert.equal(audit.summary.waived >= 1, true);
      assert.equal(audit.summary.hard >= 1, true, "a waived hard finding still counts as hard");
      assert.equal(audit.brief_applied.applied, true);
      assert.deepEqual(audit.brief_applied.waivers_used, ["disp-bounds"]);
    });

    await check("MCP audit restores persistent after the waiver is removed", async () => {
      await writeFigureBrief({
        artifactPath: e2eArtifact,
        expectedRevision: 0,
        document: makeBrief(),
      });
      const audit = await call("powerpoint_audit_figure", { slide_index: 1, artifact_path: e2eArtifact });
      const target = audit.findings.find((item) => item.finding_id === "bounds@slide:1+disp-bounds");
      assert.equal(target.status, "persistent");
      assert.equal(audit.summary.waived, 0);
      assert.deepEqual(audit.brief_applied.waivers_used, []);
    });

    await check("MCP audit applies an explicit brief_path dispute", async () => {
      const altBrief = path.join(tempRoot, "alt", "other.si-brief.json");
      await writeFigureBrief({
        briefPath: altBrief,
        document: makeBrief({
          disputes: [{ rule_id: "bounds", reason: "known detector false positive", approved_by: "user", id: "d-bounds" }],
        }),
      });
      const audit = await call("powerpoint_audit_figure", { slide_index: 1, artifact_path: e2eArtifact, brief_path: altBrief });
      const target = audit.findings.find((item) => item.finding_id === "bounds@slide:1+disp-bounds");
      assert.equal(target.status, "disputed");
      assert.equal(target.dispute_ref, "d-bounds");
      assert.equal(audit.brief_applied.path, altBrief);
      assert.equal(audit.summary.disputed >= 1, true);
    });
  } finally {
    lines.close();
    child.kill();
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log(`findings disposition smoke: ${checks} checks passed.`);

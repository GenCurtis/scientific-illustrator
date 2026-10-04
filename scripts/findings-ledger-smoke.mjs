// Verifies findings attribution (P0b): canonical rule ids, scope-stable
// finding ids, the persisted new/persistent/resolved ledger diff, and the
// audit tool contract that exposes all of it. The end-to-end section runs
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
  canonicalRuleId,
  deriveFindingIds,
  FINDINGS_SCHEMA_VERSION,
} from "../plugins/scientific-illustrator/scripts/findings-ledger.mjs";
import { resolveFindingsTarget, slugifyFigureId } from "../plugins/scientific-illustrator/scripts/figure-truth.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sci-illu-ledger-"));
let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok - ${name}`);
}

let child = null;
let lines = null;
let stderr = "";
let nextId = 0;
const pending = new Map();
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
  await check("canonical rule ids collapse cross-backend synonyms", async () => {
    assert.equal(canonicalRuleId("outside-slide"), "bounds");
    assert.equal(canonicalRuleId("outside-page"), "bounds");
    assert.equal(canonicalRuleId("text-overflow"), "text_fit");
    assert.equal(canonicalRuleId("connector-path-through-object"), "connector_path_through_object");
    assert.equal(canonicalRuleId("Duplicate Name"), "duplicate_name");
    assert.equal(canonicalRuleId(""), "unknown");
    assert.equal(canonicalRuleId(undefined), "unknown");
  });

  await check("finding ids are scope-anchored, order-insensitive, and hash-stable", async () => {
    const objects = deriveFindingIds([{ category: "outside-slide", severity: "hard", objects: ["B", "A"] }], { scopeAnchor: "slide:1" });
    assert.equal(objects[0].rule_id, "bounds");
    assert.equal(objects[0].finding_id, "bounds@slide:1+A+B");
    const named = deriveFindingIds([{ category: "duplicate_name", severity: "hard", shape_name: "Box 2" }], { scopeAnchor: "slide:2" });
    assert.equal(named[0].finding_id, "duplicate_name@slide:2+Box 2");
    const hashOne = deriveFindingIds([{ category: "mystery", severity: "warning", message: "no anchors here" }], {});
    assert.match(hashOne[0].finding_id, /^mystery@hash:[0-9a-f]{12}$/);
    const hashTwo = deriveFindingIds([{ category: "mystery", severity: "warning", message: "no anchors here" }], {});
    assert.equal(hashOne[0].finding_id, hashTwo[0].finding_id);
  });

  await check("ledger placement follows the three-level resolution", async () => {
    const projectDir = path.join(tempRoot, "placement", "project");
    const artifact = path.join(projectDir, "paper", "fig3.pptx");
    await fs.mkdir(path.join(projectDir, ".scientific-illustrator"), { recursive: true });
    await fs.mkdir(path.dirname(artifact), { recursive: true });
    const projectTarget = await resolveFindingsTarget({ artifactPath: artifact });
    assert.equal(projectTarget.resolutionBasis, "project");
    assert.equal(projectTarget.target, path.join(projectDir, ".scientific-illustrator", "figures", "fig3.si-findings.json"));
    const siblingArtifact = path.join(tempRoot, "placement", "scratch", "fig4.pptx");
    await fs.mkdir(path.dirname(siblingArtifact), { recursive: true });
    const siblingTarget = await resolveFindingsTarget({ artifactPath: siblingArtifact });
    assert.equal(siblingTarget.resolutionBasis, "sibling");
    assert.equal(siblingTarget.target, path.join(tempRoot, "placement", "scratch", "fig4.si-findings.json"));
  });

  const ledgerDir = path.join(tempRoot, "ledger-flow");
  const ledgerArtifact = path.join(ledgerDir, "deck.pptx");
  const ledgerPath = path.join(ledgerDir, "deck.si-findings.json");
  const findingA = { category: "outside-slide", severity: "hard", objects: ["A"] };
  const findingB = { category: "duplicate-name", severity: "hard", objects: ["B"] };
  await fs.mkdir(ledgerDir, { recursive: true });

  await check("first audit has no baseline and records one", async () => {
    const first = await applyFindingsLedger({ artifactPath: ledgerArtifact, findings: [findingA], scopeAnchor: "slide:1", now: "2026-01-01T00:00:00.000Z" });
    assert.equal(first.ledger_applied.applied, true);
    assert.equal(first.ledger_applied.baseline, "none");
    assert.equal(first.ledger_applied.resolution_basis, "sibling");
    assert.equal(first.findings[0].finding_id, "bounds@slide:1+A");
    assert.equal(first.findings[0].status, "new");
    assert.equal(first.summary.new, 1);
    assert.equal(first.summary.hard, 1);
    const stored = JSON.parse(await fs.readFile(ledgerPath, "utf8"));
    assert.equal(stored.schema, FINDINGS_SCHEMA_VERSION);
    assert.equal(stored.entries.length, 1);
    assert.deepEqual(stored.last_audits["slide:1"].finding_ids, ["bounds@slide:1+A"]);
  });

  await check("second audit marks old findings persistent and new ones new", async () => {
    const second = await applyFindingsLedger({ artifactPath: ledgerArtifact, findings: [findingA, findingB], scopeAnchor: "slide:1" });
    assert.equal(second.ledger_applied.baseline, "previous_audit");
    assert.deepEqual(second.findings.map((finding) => finding.status), ["persistent", "new"]);
    assert.equal(second.summary.persistent, 1);
    assert.equal(second.summary.new, 1);
    const stored = JSON.parse(await fs.readFile(ledgerPath, "utf8"));
    assert.equal(stored.entries.find((entry) => entry.finding_id === "bounds@slide:1+A").first_seen, "2026-01-01T00:00:00.000Z");
  });

  await check("a fixed finding resolves with its severity and reappearing is new again", async () => {
    const third = await applyFindingsLedger({ artifactPath: ledgerArtifact, findings: [findingB], scopeAnchor: "slide:1" });
    assert.deepEqual(third.findings.map((finding) => finding.status), ["persistent"]);
    assert.equal(third.resolved_findings.length, 1);
    assert.equal(third.resolved_findings[0].finding_id, "bounds@slide:1+A");
    assert.equal(third.resolved_findings[0].severity, "hard");
    assert.equal(third.summary.resolved, 1);
    const regression = await applyFindingsLedger({ artifactPath: ledgerArtifact, findings: [findingA, findingB], scopeAnchor: "slide:1" });
    assert.equal(regression.findings.find((finding) => finding.finding_id === "bounds@slide:1+A").status, "new");
  });

  await check("audit scopes stay isolated and foreign entries survive", async () => {
    const slideTwo = await applyFindingsLedger({ artifactPath: ledgerArtifact, findings: [findingA], scopeAnchor: "slide:2" });
    assert.equal(slideTwo.findings[0].finding_id, "bounds@slide:2+A");
    assert.equal(slideTwo.findings[0].status, "new");
    const stored = JSON.parse(await fs.readFile(ledgerPath, "utf8"));
    assert.ok(stored.entries.some((entry) => entry.scope === "slide:1"), "slide:1 entries must survive a slide:2 audit");
    assert.ok(stored.entries.some((entry) => entry.scope === "slide:2"));
    assert.ok(stored.last_audits["slide:1"] && stored.last_audits["slide:2"]);
  });

  await check("a corrupt ledger degrades and is rebuilt, never blocking the audit", async () => {
    await fs.writeFile(ledgerPath, "{ not json");
    const rebuilt = await applyFindingsLedger({ artifactPath: ledgerArtifact, findings: [findingA], scopeAnchor: "slide:1" });
    assert.equal(rebuilt.ledger_applied.applied, true);
    assert.ok(rebuilt.ledger_applied.reset_reason);
    assert.equal(rebuilt.findings[0].status, "new");
    const stored = JSON.parse(await fs.readFile(ledgerPath, "utf8"));
    assert.equal(stored.schema, FINDINGS_SCHEMA_VERSION);
  });

  await check("without a baseline path findings stay id-annotated but unattributed", async () => {
    const noPath = await applyFindingsLedger({ artifactPath: null, findings: [findingA], scopeAnchor: "slide:1" });
    assert.equal(noPath.ledger_applied.applied, false);
    assert.match(noPath.ledger_applied.reason, /no artifact_path or findings_path/);
    assert.equal(noPath.findings[0].finding_id, "bounds@slide:1+A");
    assert.equal(noPath.findings[0].status, "new");
  });

  await check("paths outside the allowed root fail loudly", async () => {
    const previousRoot = process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT;
    process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT = path.join(tempRoot, "allowed");
    try {
      await fs.mkdir(path.join(tempRoot, "allowed"), { recursive: true });
      await fs.mkdir(path.join(tempRoot, "outside"), { recursive: true });
      await assert.rejects(
        () => applyFindingsLedger({ artifactPath: path.join(tempRoot, "outside", "deck.pptx"), findings: [findingA], scopeAnchor: "slide:1" }),
        /ALLOWED_ROOT/
      );
    } finally {
      if (previousRoot === undefined) delete process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT;
      else process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT = previousRoot;
    }
  });

  await check("hash fallback differentiates distinct evidence and keeps scope anchoring", async () => {
    const one = deriveFindingIds([{ category: "mystery", severity: "warning", message: "evidence one" }], {});
    const two = deriveFindingIds([{ category: "mystery", severity: "warning", message: "evidence two" }], {});
    assert.notEqual(one[0].finding_id, two[0].finding_id, "distinct evidence must not collapse into one id");
    const scoped = deriveFindingIds([{ category: "mystery", severity: "warning", message: "evidence one" }], { scopeAnchor: "slide:1" });
    assert.match(scoped[0].finding_id, /^mystery@slide:1\+hash:[0-9a-f]{12}$/);
  });

  await check("non-object findings pass through the attribution layer harmlessly", async () => {
    const applied = await applyFindingsLedger({ artifactPath: ledgerArtifact, findings: [null, findingA], scopeAnchor: "slide:9" });
    assert.equal(applied.findings[0], null);
    assert.equal(applied.findings[1].finding_id, "bounds@slide:9+A");
    assert.equal(applied.findings[1].status, "new");
    const annotated = await annotateAuditResult({ findings: [null, findingA] }, { artifactPath: ledgerArtifact, scopeAnchor: "slide:11" });
    assert.equal(annotated.findings[0], null);
    assert.equal(annotated.findings[1].status, "new");
  });

  await check("duplicate finding ids collapse into one ledger entry", async () => {
    await applyFindingsLedger({ artifactPath: ledgerArtifact, findings: [findingA, { ...findingA }], scopeAnchor: "slide:10" });
    const stored = JSON.parse(await fs.readFile(ledgerPath, "utf8"));
    const scoped = stored.entries.filter((entry) => entry.scope === "slide:10");
    assert.equal(scoped.length, 1, "one finding id must produce exactly one entry");
  });

  await check("anchor sets beyond the cap still separate distinct findings", async () => {
    const base = Array.from({ length: 40 }, (_, index) => `A${String(index).padStart(2, "0")}`);
    const one = deriveFindingIds([{ category: "mystery", severity: "warning", objects: [...base, "tail-a"] }], {});
    const two = deriveFindingIds([{ category: "mystery", severity: "warning", objects: [...base, "tail-b"] }], {});
    assert.match(one[0].finding_id, /\+more:[0-9a-f]{12}$/);
    assert.notEqual(one[0].finding_id, two[0].finding_id, "differences beyond the anchor cap must not collapse");
  });

  await check("malformed foreign ledger entries are dropped, not retained", async () => {
    const malformedPath = path.join(ledgerDir, "malformed.si-findings.json");
    await fs.writeFile(
      malformedPath,
      JSON.stringify({
        schema: FINDINGS_SCHEMA_VERSION,
        artifact_path: null,
        updated_at: "2026-01-01T00:00:00.000Z",
        entries: [
          null,
          { scope: "orphan" },
          { finding_id: "", scope: "orphan" },
          { finding_id: "x@orphan", scope: "orphan", rule_id: "x", severity: "warning", anchors: ["orphan"], first_seen: "t0", last_seen: "t0" },
        ],
        last_audits: {},
      })
    );
    await applyFindingsLedger({ findingsPath: malformedPath, findings: [findingA], scopeAnchor: "slide:1" });
    const stored = JSON.parse(await fs.readFile(malformedPath, "utf8"));
    const orphans = stored.entries.filter((entry) => entry.scope === "orphan");
    assert.equal(orphans.length, 1, "only the well-formed foreign entry survives");
    assert.equal(orphans[0].finding_id, "x@orphan");
    assert.ok(stored.entries.every((entry) => entry && typeof entry.finding_id === "string"));
  });

  await check("attribution degradation never fails the audit", async () => {
    const previousRoot = process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT;
    process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT = path.join(tempRoot, "allowed");
    try {
      await fs.mkdir(path.join(tempRoot, "allowed"), { recursive: true });
      await fs.mkdir(path.join(tempRoot, "outside"), { recursive: true });
      const result = await annotateAuditResult(
        { findings: [findingA] },
        { artifactPath: path.join(tempRoot, "outside", "deck.pptx"), scopeAnchor: "slide:1" }
      );
      assert.equal(result.ledger_applied.applied, false);
      assert.match(result.ledger_applied.reason, /ALLOWED_ROOT/);
      assert.equal(result.findings[0].finding_id, "bounds@slide:1+A");
      assert.equal(result.findings[0].status, "new");
      assert.ok(result.summary, "a degraded audit still reports a summary");
    } finally {
      if (previousRoot === undefined) delete process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT;
      else process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT = previousRoot;
    }
  });

  // End-to-end through the real MCP server on the no-application OOXML route.
  delete process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT;
  const stateDir = path.join(tempRoot, "state");
  await fs.mkdir(stateDir, { recursive: true });
  child = spawn(process.execPath, [path.join(root, "plugins/scientific-illustrator/scripts/powerpoint-server.mjs")], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      SCIENTIFIC_ILLUSTRATOR_PPT_HOST: "wps",
      SCIENTIFIC_ILLUSTRATOR_PPT_BACKEND: "ooxml",
      SCIENTIFIC_ILLUSTRATOR_POWERPOINT_SYNC: "0",
      SCIENTIFIC_ILLUSTRATOR_STATE_DIR: stateDir,
    },
  });
  lines = createInterface({ input: child.stdout });
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

  const boundsId = "bounds@slide:1+ledger-bounds";
  const badShape = (slideIndex) => ({
    slide_index: slideIndex,
    name: "ledger-bounds",
    shape: "rectangle",
    left: 50000,
    top: 10,
    width: 40,
    height: 20,
  });

  await check("MCP audit surfaces new ids/status and persists a sibling ledger", async () => {
    await call("powerpoint_new_presentation", {});
    await call("powerpoint_add_shape", badShape(1));
    const auditOne = await call("powerpoint_audit_figure", { slide_index: 1 });
    const finding = auditOne.findings.find((item) => item.finding_id === boundsId);
    assert.ok(finding, `expected ${boundsId} among ${JSON.stringify(auditOne.findings.map((item) => item.finding_id))}`);
    assert.equal(finding.status, "new");
    assert.equal(finding.rule_id, "bounds");
    assert.equal(finding.anchors, undefined, "internal anchors must not leak into the tool output");
    assert.equal(auditOne.ledger_applied.applied, true);
    assert.equal(auditOne.ledger_applied.scope, "slide:1");
    assert.ok(auditOne.summary.new >= 1 && auditOne.summary.hard >= 1);
    const expectedLedger = path.join(stateDir, `${slugifyFigureId(path.parse(auditOne.path).name)}.si-findings.json`);
    assert.equal(auditOne.ledger_applied.path, expectedLedger);
    const stored = JSON.parse(await fs.readFile(expectedLedger, "utf8"));
    assert.equal(stored.schema, FINDINGS_SCHEMA_VERSION);
    assert.ok(stored.last_audits["slide:1"].finding_ids.includes(boundsId));
  });

  await check("MCP repeated audit reports persistent, deleting the shape resolves it", async () => {
    const auditTwo = await call("powerpoint_audit_figure", { slide_index: 1 });
    assert.equal(auditTwo.findings.find((item) => item.finding_id === boundsId).status, "persistent");
    assert.equal(auditTwo.discipline.unchanged_since_last_call, true);
    assert.ok(auditTwo.summary.persistent >= 1);
    await call("powerpoint_delete_shape", { slide_index: 1, shape_name: "ledger-bounds", confirm: true });
    const auditThree = await call("powerpoint_audit_figure", { slide_index: 1 });
    assert.equal(auditThree.findings.some((item) => item.finding_id === boundsId), false);
    const resolved = auditThree.resolved_findings.find((item) => item.finding_id === boundsId);
    assert.ok(resolved, "the removed finding must be reported as resolved");
    assert.equal(resolved.severity, "hard");
    assert.ok(auditThree.summary.resolved >= 1);
    await call("powerpoint_add_shape", badShape(1));
    const auditFour = await call("powerpoint_audit_figure", { slide_index: 1 });
    assert.equal(auditFour.findings.find((item) => item.finding_id === boundsId).status, "new", "a reintroduced finding starts a new baseline entry");
  });

  await check("slide scopes stay independent across the MCP surface", async () => {
    await call("powerpoint_add_slide", { position: 2, layout: "blank" });
    await call("powerpoint_add_shape", badShape(2));
    const auditSlideTwo = await call("powerpoint_audit_figure", { slide_index: 2 });
    assert.equal(auditSlideTwo.findings.find((item) => item.finding_id === "bounds@slide:2+ledger-bounds").status, "new");
    const auditSlideOne = await call("powerpoint_audit_figure", { slide_index: 1 });
    assert.equal(auditSlideOne.findings.find((item) => item.finding_id === boundsId).status, "persistent");
    const expectedLedger = path.join(stateDir, `${slugifyFigureId(path.parse(auditSlideOne.path).name)}.si-findings.json`);
    const stored = JSON.parse(await fs.readFile(expectedLedger, "utf8"));
    assert.ok(stored.last_audits["slide:1"].finding_ids.includes(boundsId));
    assert.ok(stored.last_audits["slide:2"].finding_ids.includes("bounds@slide:2+ledger-bounds"));
  });

  await check("an explicit artifact_path anchors its own baseline", async () => {
    const explicitDir = path.join(tempRoot, "explicit-artifact");
    await fs.mkdir(explicitDir, { recursive: true });
    const explicitArtifact = path.join(explicitDir, "custom-deck.pptx");
    const audit = await call("powerpoint_audit_figure", { slide_index: 1, artifact_path: explicitArtifact });
    assert.equal(audit.ledger_applied.applied, true);
    assert.equal(audit.ledger_applied.path, path.join(explicitDir, "custom-deck.si-findings.json"));
    assert.equal(audit.findings.find((item) => item.finding_id === boundsId).status, "new");
  });

  console.log(`findings ledger: canonical ids, scope-stable attribution, and the persisted new/persistent/resolved diff work end to end (${checks} checks).`);
} finally {
  try {
    lines?.close();
  } catch {}
  try {
    child?.kill();
  } catch {}
  await fs.rm(tempRoot, { recursive: true, force: true });
}

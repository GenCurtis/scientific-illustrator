// Verifies the P4c deck consistency audit glue (applyDeckConsistency) and the
// powerpoint_audit_deck MCP tool: slide count against the deck truth, font and
// palette outliers against the style contract, missing slide briefs, severity
// policy, graceful degradation, and the OOXML end-to-end path through a real
// server process.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { applyDeckConsistency } from "../plugins/scientific-illustrator/scripts/deck-audit.mjs";
import { DECK_SCHEMA_VERSION, writeDeck } from "../plugins/scientific-illustrator/scripts/figure-deck.mjs";
import { STYLE_SCHEMA_VERSION, writeFigureStyle } from "../plugins/scientific-illustrator/scripts/figure-style.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sci-illu-deck-consistency-"));
process.on("exit", () => {
  try {
    rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok - ${name}`);
}

function makeAuditValue(overrides = {}) {
  return {
    slide_count: 3,
    slides: [
      { index: 1, shape_count: 2, fonts: ["Arial"], colors: ["#2166AC"], max_font_pt: 24 },
      { index: 2, shape_count: 3, fonts: ["Comic Sans"], colors: ["#FF00FF"], max_font_pt: 18 },
      { index: 3, shape_count: 1, fonts: ["Arial"], colors: ["#2166AC", "#ffffff"], max_font_pt: 24 },
    ],
    findings: [],
    hard_failure_count: 0,
    warning_count: 0,
    passed_deterministic_gate: true,
    ...overrides,
  };
}

function makeDeckDocument(overrides = {}) {
  return {
    schema: DECK_SCHEMA_VERSION,
    deck_id: "consistency-demo",
    profile: "slides",
    style_id: "main",
    narrative: { message: "A short talk." },
    slides: [
      { id: "01-title", role: "title", message: "Title" },
      { id: "02-result", role: "result", message: "Result", brief: "slides/02-result.brief.json" },
    ],
    ...overrides,
  };
}

function makeStyleDocument(overrides = {}) {
  return {
    schema: STYLE_SCHEMA_VERSION,
    style_id: "main",
    fonts: { family: "Arial", fallbacks: ["Helvetica"] },
    palette: { primary: "#2166AC" },
    enforce: "advisory",
    ...overrides,
  };
}

async function setupConsistencyFixture() {
  const base = path.join(tempRoot, `fixture-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(base, { recursive: true });
  const artifact = path.join(base, "deck.pptx");
  await writeDeck({ artifactPath: artifact, document: makeDeckDocument() });
  await writeFigureStyle({ artifactPath: artifact, document: makeStyleDocument() });
  return artifact;
}

try {
  // ----------------------------------------------------- module level
  await check("non-object results and missing slide summaries degrade without throwing", async () => {
    assert.equal((await applyDeckConsistency(null)).applied, false);
    assert.equal((await applyDeckConsistency("text")).applied, false);
    const value = makeAuditValue({ slides: undefined });
    const summary = await applyDeckConsistency(value);
    assert.equal(summary.applied, false);
    assert.match(summary.reason, /per-slide summaries/);
    assert.equal(value.deck_consistency.applied, false);
  });

  await check("full consistency pass finds slide-count, font, palette, and missing-brief issues", async () => {
    const artifact = await setupConsistencyFixture();
    const value = makeAuditValue();
    const summary = await applyDeckConsistency(value, { artifactPath: artifact });
    assert.equal(summary.applied, true);
    assert.equal(summary.slide_count, 3);
    assert.equal(summary.deck_applied.revision, 0);
    assert.equal(summary.style_applied.revision, 0);
    assert.equal(summary.findings_added, 4);
    const categories = value.findings.map((finding) => finding.category).sort();
    assert.deepEqual(categories, [
      "deck_font_outlier",
      "deck_palette_outlier",
      "deck_slide_brief_missing",
      "deck_slide_count_mismatch",
    ]);
    const font = value.findings.find((finding) => finding.category === "deck_font_outlier");
    assert.equal(font.severity, "warning");
    assert.equal(font.shape_name, "Comic Sans");
    assert.match(font.message, /slides 2/);
    const palette = value.findings.find((finding) => finding.category === "deck_palette_outlier");
    assert.equal(palette.shape_name, "#ff00ff");
    assert.equal(value.findings.some((finding) => finding.shape_name === "#ffffff"), false);
    assert.equal(value.findings.some((finding) => finding.shape_name === "#2166AC"), false);
    assert.equal(value.hard_failure_count, 0);
    assert.equal(value.warning_count, 4);
    assert.equal(value.passed_deterministic_gate, true);
  });

  await check("pre-existing findings are preserved and the counts include them", async () => {
    const artifact = await setupConsistencyFixture();
    const value = makeAuditValue({
      findings: [{ severity: "hard", category: "legacy", shape_name: "X", message: "legacy" }],
      hard_failure_count: 1,
      warning_count: 0,
      passed_deterministic_gate: false,
    });
    await applyDeckConsistency(value, { artifactPath: artifact });
    assert.equal(value.findings.length, 5);
    assert.equal(value.findings[0].category, "legacy");
    assert.equal(value.hard_failure_count, 1);
    assert.equal(value.warning_count, 4);
    assert.equal(value.passed_deterministic_gate, false);
  });

  await check("style enforce=hard upgrades outlier findings but not truth checks", async () => {
    const artifact = await setupConsistencyFixture();
    await writeFigureStyle({
      artifactPath: artifact,
      document: makeStyleDocument({ enforce: "hard" }),
      expectedRevision: 0,
    });
    const value = makeAuditValue();
    await applyDeckConsistency(value, { artifactPath: artifact });
    const font = value.findings.find((finding) => finding.category === "deck_font_outlier");
    const palette = value.findings.find((finding) => finding.category === "deck_palette_outlier");
    const mismatch = value.findings.find((finding) => finding.category === "deck_slide_count_mismatch");
    assert.equal(font.severity, "hard");
    assert.equal(palette.severity, "hard");
    assert.equal(mismatch.severity, "warning");
    assert.equal(value.hard_failure_count, 2);
    assert.equal(value.passed_deterministic_gate, false);
  });

  await check("without a style contract only truth checks run", async () => {
    const base = path.join(tempRoot, "no-style");
    await fs.mkdir(base, { recursive: true });
    const artifact = path.join(base, "plain.pptx");
    await writeDeck({ artifactPath: artifact, document: makeDeckDocument() });
    const value = makeAuditValue();
    const summary = await applyDeckConsistency(value, { artifactPath: artifact });
    assert.equal(summary.applied, true);
    assert.equal(summary.style_applied, null);
    const categories = value.findings.map((finding) => finding.category).sort();
    assert.deepEqual(categories, ["deck_slide_brief_missing", "deck_slide_count_mismatch"]);
  });

  await check("a corrupt deck degrades to warnings while style checks still run", async () => {
    const artifact = await setupConsistencyFixture();
    const deckFile = path.join(path.dirname(artifact), "deck.si-deck.json");
    await fs.writeFile(deckFile, "{broken", "utf8");
    const value = makeAuditValue();
    const summary = await applyDeckConsistency(value, { artifactPath: artifact });
    assert.equal(summary.applied, true);
    assert.equal(summary.deck_applied, null);
    assert.equal(summary.warnings.some((warning) => warning.includes("deck truth could not be read")), true);
    const categories = value.findings.map((finding) => finding.category).sort();
    assert.deepEqual(categories, ["deck_font_outlier", "deck_palette_outlier"]);
  });

  await check("a missing deck still runs style checks without warnings", async () => {
    const base = path.join(tempRoot, "no-deck");
    await fs.mkdir(base, { recursive: true });
    const artifact = path.join(base, "figure-deck.pptx");
    await writeFigureStyle({ artifactPath: artifact, document: makeStyleDocument() });
    const value = makeAuditValue();
    const summary = await applyDeckConsistency(value, { artifactPath: artifact });
    assert.equal(summary.applied, true);
    assert.equal(summary.deck_applied, null);
    assert.deepEqual(summary.warnings, []);
    assert.equal(value.findings.some((finding) => finding.category === "deck_font_outlier"), true);
  });

  // ----------------------------------------------------- MCP + OOXML end to end
  console.log("MCP + OOXML end to end");
  {
    const stateDir = path.join(tempRoot, "state");
    await fs.mkdir(stateDir, { recursive: true });
    const child = spawn(process.execPath, [path.join(root, "plugins", "scientific-illustrator", "scripts", "powerpoint-server.mjs")], {
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
        }, 30000).unref();
      });
    }
    async function call(name, args = {}) {
      const result = await request("tools/call", { name, arguments: args });
      if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content).slice(0, 300)}`);
      return result.structuredContent;
    }

    try {
      await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "deck-consistency-smoke", version: "1.0.0" } });

      await check("tools/list exposes powerpoint_audit_deck with the discipline contract", async () => {
        const tools = await request("tools/list");
        const tool = tools.tools.find((entry) => entry.name === "powerpoint_audit_deck");
        assert.ok(tool, "powerpoint_audit_deck must be listed");
        assert.equal(tool.inputSchema.additionalProperties, false);
        assert.match(tool.description, /discipline/);
      });

      const created = await call("powerpoint_new_presentation", {});
      assert.ok(created);
      await call("powerpoint_add_slide", {});
      await call("powerpoint_add_slide", {});
      const status = await call("powerpoint_status", {});
      const managedPath = status.managed_path;
      assert.equal(typeof managedPath, "string");

      await check("the OOXML deck audit reports per-slide summaries and the deck mismatch", async () => {
        await writeDeck({ artifactPath: managedPath, document: makeDeckDocument() });
        const audit = await call("powerpoint_audit_deck", { artifact_path: managedPath });
        assert.equal(audit.slide_count, 3);
        assert.equal(audit.slides.length, 3);
        assert.equal(audit.deck_consistency.applied, true);
        assert.equal(audit.deck_consistency.deck_applied.revision, 0);
        const categories = audit.findings.map((finding) => finding.category);
        assert.ok(categories.includes("deck_slide_count_mismatch"), `expected mismatch in ${categories.join(", ")}`);
        assert.ok(categories.includes("deck_slide_brief_missing"));
        assert.equal(audit.discipline.redundant_deck_audits, 0);
      });

      await check("repeating the unchanged deck audit is counted as redundant", async () => {
        const audit = await call("powerpoint_audit_deck", { artifact_path: managedPath });
        assert.equal(audit.discipline.redundant_deck_audits, 1);
        assert.equal(audit.discipline.unchanged_since_last_call, true);
      });

      await check("an explicit artifact_path outranks the backend-reported source path", async () => {
        // Produce a real file-backed session so the backend reports a source_path.
        const savedDir = path.join(tempRoot, "saved");
        await fs.mkdir(savedDir, { recursive: true });
        const savedPath = path.join(savedDir, "launched.pptx");
        await call("powerpoint_save", { output_path: savedPath });
        await call("powerpoint_close_presentation", { confirm: true });
        await call("powerpoint_launch", { file_path: savedPath });
        const launchedStatus = await call("powerpoint_status", {});
        assert.equal(path.resolve(launchedStatus.source_path), path.resolve(savedPath));
        // Deck truth next to the launched file disagrees with the anchor deck.
        await writeDeck({
          artifactPath: savedPath,
          document: makeDeckDocument({
            slides: [
              { id: "01", role: "title" },
              { id: "02", role: "method" },
              { id: "03", role: "result" },
              { id: "04", role: "discussion" },
              { id: "05", role: "summary" },
            ],
          }),
        });
        const anchorDir = path.join(tempRoot, "explicit-anchor");
        await fs.mkdir(anchorDir, { recursive: true });
        const anchor = path.join(anchorDir, "explicit.pptx");
        await writeDeck({
          artifactPath: anchor,
          document: makeDeckDocument({ slides: [{ id: "solo", role: "title", message: "Only" }] }),
        });
        const audit = await call("powerpoint_audit_deck", { artifact_path: anchor });
        assert.equal(audit.deck_consistency.deck_applied.path, path.join(anchorDir, "explicit.si-deck.json"));
        const mismatch = audit.findings.find((finding) => finding.category === "deck_slide_count_mismatch");
        assert.match(mismatch.message, /lists 1 slides/);
      });
    } finally {
      lines.close();
      child.kill();
    }
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log(`deck consistency smoke: ${checks} checks passed.`);

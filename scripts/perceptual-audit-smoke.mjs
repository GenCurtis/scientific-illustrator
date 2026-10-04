// Verifies the P3b perceptual audit integration: the python OOXML audit emits
// a perceptual model, applyPerceptualQa resolves brief/plan/publisher rules,
// evaluates at delivery size, merges findings before ledger attribution, and
// degrades without failing the audit. Module tests plus a real OOXML MCP
// end-to-end (no application needed).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { BRIEF_SCHEMA_VERSION, writeFigureBrief } from "../plugins/scientific-illustrator/scripts/figure-truth.mjs";
import { PLAN_SCHEMA_VERSION, writeFigurePlan } from "../plugins/scientific-illustrator/scripts/figure-plan.mjs";
import { STYLE_SCHEMA_VERSION, writeFigureStyle } from "../plugins/scientific-illustrator/scripts/figure-style.mjs";
import { applyPerceptualQa } from "../plugins/scientific-illustrator/scripts/perceptual-audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sci-illu-perceptual-audit-"));
// Cleanup runs even when a check throws, so failed runs never leak temp dirs.
process.on("exit", () => {
  try {
    rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; the OS temp directory also reclaims it eventually.
  }
});
let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok - ${name}`);
}

function makeModel(elements) {
  return {
    schema: "scientific-illustrator/perceptual-model@1",
    canvas: { width_pt: 720, height_pt: 540 },
    elements,
  };
}

function makeAudit(model) {
  return { findings: [], hard_failure_count: 0, warning_count: 0, passed_deterministic_gate: true, perceptual_model: model };
}

async function writeBriefAndPlan(directory, briefDocument = {}) {
  const briefPath = path.join(directory, "fig.si-brief.json");
  await writeFigureBrief({
    briefPath,
    document: {
      schema: BRIEF_SCHEMA_VERSION,
      figure_id: "fig",
      profile: "paper-figure",
      recreation_policy: "publication-ready",
      inventory: [{ id: "t1", kind: "text", text_verbatim: "Tiny" }],
      ...briefDocument,
    },
  });
  await writeFigurePlan({
    briefPath,
    document: {
      schema: PLAN_SCHEMA_VERSION,
      figure_id: "fig",
      figure_kind: "process",
      archetype: "linear",
      render_contexts: [{ id: "publication", width_mm: 254 }],
    },
  });
  return briefPath;
}

await check("a missing perceptual model degrades without failing", async () => {
  const value = { findings: [] };
  const result = await applyPerceptualQa(value, {});
  assert.equal(result.applied, false);
  assert.match(result.reason, /did not provide a perceptual model/);
  assert.deepEqual(value.perceptual_qa, result);
});

await check("brief and plan drive delivery-size findings", async () => {
  const directory = path.join(tempRoot, "module-basic");
  const briefPath = await writeBriefAndPlan(directory);
  const value = makeAudit(
    makeModel([
      { name: "Tiny", kind: "text", font_pt: 5, color: "#222222" },
      { name: "Photo", kind: "picture", pixel_width: 150, pixel_height: 150, placed_width_pt: 72, placed_height_pt: 72 },
    ])
  );
  const result = await applyPerceptualQa(value, { briefPath });
  assert.equal(result.applied, true);
  assert.equal(result.brief_applied.revision, 0);
  assert.equal(result.plan_applied.figure_kind, "process");
  assert.equal(result.contexts.length, 1);
  assert.equal(result.contexts[0].id, "publication");
  assert.deepEqual(result.warnings, []);
  const categories = value.findings.map((finding) => finding.category);
  assert.equal(categories.includes("font_size_below_minimum"), true);
  assert.equal(categories.includes("effective_dpi_below_minimum"), true);
  assert.equal(value.warning_count, value.findings.length);
  assert.equal(value.hard_failure_count, 0);
  assert.equal(value.passed_deterministic_gate, true);
  const fontFinding = value.findings.find((finding) => finding.category === "font_size_below_minimum");
  assert.equal(fontFinding.shape_name, "Tiny");
  assert.match(fontFinding.message, /~5pt/);
  assert.equal("perceptual_model" in value, false, "the raw model is stripped from the audit output");
});

await check("publisher thresholds and provenance reach the audit", async () => {
  const directory = path.join(tempRoot, "module-publisher");
  const briefPath = await writeBriefAndPlan(directory);
  const value = makeAudit(
    makeModel([{ name: "Photo", kind: "picture", pixel_width: 150, pixel_height: 150, placed_width_pt: 72, placed_height_pt: 72 }])
  );
  const result = await applyPerceptualQa(value, { briefPath, publisher: "elsevier", rasterClass: "halftone" });
  assert.equal(result.applied, true);
  assert.equal(value.publisher_spec.applied, true);
  assert.match(value.publisher_spec.runtime_statement, /Elsevier/);
  assert.equal(value.publisher_spec.layers.some((layer) => layer.kind === "publisher-spec"), true);
  const finding = value.findings.find((entry) => entry.category === "effective_dpi_below_minimum");
  assert.equal(finding.rule_token, "raster.halftone.minimum_dpi");
});

await check("an unknown publisher degrades to profile defaults", async () => {
  const directory = path.join(tempRoot, "module-unknown-publisher");
  const briefPath = await writeBriefAndPlan(directory);
  const value = makeAudit(makeModel([{ name: "Tiny", kind: "text", font_pt: 5, color: "#222222" }]));
  const result = await applyPerceptualQa(value, { briefPath, publisher: "wiley" });
  assert.equal(result.applied, true);
  assert.equal(value.publisher_spec.applied, false);
  assert.match(value.publisher_spec.reason, /wiley/);
  assert.equal(value.findings.some((finding) => finding.category === "font_size_below_minimum"), true);
});

await check("a missing brief still runs context-independent checks", async () => {
  const directory = path.join(tempRoot, "module-missing-brief");
  await fs.mkdir(directory, { recursive: true });
  const value = makeAudit(makeModel([{ name: "Note", kind: "text", font_pt: 5, color: "#777777" }]));
  const result = await applyPerceptualQa(value, { artifactPath: path.join(directory, "deck.pptx") });
  assert.equal(result.applied, true);
  assert.equal(result.brief_applied, null);
  assert.equal(result.plan_applied, null);
  const categories = value.findings.map((finding) => finding.category);
  assert.equal(categories.includes("contrast_below_minimum"), true);
  assert.equal(categories.includes("font_size_below_minimum"), false);
});

await check("malformed inputs never throw", async () => {
  const nulled = await applyPerceptualQa(null, {});
  assert.equal(nulled.applied, false);
  const broken = makeAudit({ canvas: { width_pt: -1 }, elements: [] });
  const outcome = await applyPerceptualQa(broken, {});
  assert.equal(outcome.applied, true);
  assert.equal(typeof outcome.error, "string");
  assert.deepEqual(broken.findings, []);
});

await check("existing hard findings keep their counts and gate after merging", async () => {
  const directory = path.join(tempRoot, "module-hard");
  const briefPath = await writeBriefAndPlan(directory);
  const value = makeAudit(makeModel([{ name: "Tiny", kind: "text", font_pt: 5, color: "#222222" }]));
  value.findings = [{ severity: "hard", category: "geometry", shape_name: "Broken", message: "zero size" }];
  value.hard_failure_count = 1;
  const result = await applyPerceptualQa(value, { briefPath });
  assert.equal(result.applied, true);
  assert.equal(value.hard_failure_count, 1);
  assert.equal(value.warning_count, value.findings.length - 1);
  assert.equal(value.passed_deterministic_gate, false);
});

await check("the recreation policy is passed into the evaluation", async () => {
  const directory = path.join(tempRoot, "module-policy");
  const briefPath = await writeBriefAndPlan(directory, { recreation_policy: "faithful" });
  const value = makeAudit(makeModel([{ name: "Tiny", kind: "text", font_pt: 5, color: "#222222" }]));
  const result = await applyPerceptualQa(value, { briefPath });
  assert.equal(result.policy, "faithful");
});

await check("an unreadable brief surfaces a warning instead of silence", async () => {
  const directory = path.join(tempRoot, "module-corrupt");
  await fs.mkdir(directory, { recursive: true });
  const briefPath = path.join(directory, "fig.si-brief.json");
  await fs.writeFile(briefPath, "{not json", "utf8");
  const value = makeAudit(makeModel([{ name: "Note", kind: "text", font_pt: 5, color: "#222222" }]));
  const result = await applyPerceptualQa(value, { briefPath });
  assert.equal(result.applied, true);
  assert.equal(result.warnings.some((warning) => warning.includes("could not be read")), true);
  assert.deepEqual(result.warnings, result.warnings.filter((warning) => typeof warning === "string"));
});

await check("an unreadable plan surfaces a warning instead of silence", async () => {
  const directory = path.join(tempRoot, "module-corrupt-plan");
  const briefPath = await writeBriefAndPlan(directory);
  await fs.writeFile(path.join(directory, "fig.si-plan.json"), "{not json", "utf8");
  const value = makeAudit(makeModel([{ name: "Note", kind: "text", font_pt: 5, color: "#222222" }]));
  const result = await applyPerceptualQa(value, { briefPath });
  assert.equal(result.applied, true);
  assert.equal(result.warnings.some((warning) => warning.includes("design plan could not be read")), true);
});

await check("style contracts produce style_deviation findings", async () => {
  const directory = path.join(tempRoot, "module-style");
  const briefPath = await writeBriefAndPlan(directory);
  await writeFigureStyle({
    artifactPath: briefPath,
    styleId: "main",
    document: { schema: STYLE_SCHEMA_VERSION, style_id: "main", fonts: { family: "Arial" }, enforce: "advisory" },
  });
  const value = makeAudit(makeModel([{ name: "Tiny", kind: "text", font_pt: 5, font_name: "Comic Sans MS", color: "#222222" }]));
  const result = await applyPerceptualQa(value, { briefPath });
  assert.equal(result.applied, true);
  assert.equal(result.style_applied.revision, 0);
  const deviation = value.findings.find((finding) => finding.category === "style_deviation");
  assert.ok(deviation);
  assert.equal(deviation.token, "fonts.family");
  assert.equal(deviation.expected, "Arial");
  assert.equal(deviation.actual, "Comic Sans MS");
  assert.equal(deviation.severity, "warning");
});

await check("a brief style_id selects the matching style file", async () => {
  const directory = path.join(tempRoot, "module-style-id");
  const briefPath = await writeBriefAndPlan(directory, { style_id: "custom" });
  await writeFigureStyle({
    artifactPath: briefPath,
    styleId: "custom",
    document: { schema: STYLE_SCHEMA_VERSION, style_id: "custom", fonts: { family: "Arial" } },
  });
  const value = makeAudit(makeModel([{ name: "T", kind: "text", font_pt: 18, font_name: "Comic Sans MS" }]));
  const result = await applyPerceptualQa(value, { briefPath });
  assert.equal(result.style_applied.revision, 0);
  assert.equal(value.findings.some((finding) => finding.category === "style_deviation" && finding.actual === "Comic Sans MS"), true);
});

await check("an unreadable style surfaces a warning instead of silence", async () => {
  const directory = path.join(tempRoot, "module-corrupt-style");
  const briefPath = await writeBriefAndPlan(directory);
  await fs.writeFile(path.join(directory, "main.si-style.json"), "{not json", "utf8");
  const value = makeAudit(makeModel([{ name: "Note", kind: "text", font_pt: 5, color: "#222222" }]));
  const result = await applyPerceptualQa(value, { briefPath });
  assert.equal(result.applied, true);
  assert.equal(result.warnings.some((warning) => warning.includes("figure style could not be read")), true);
});

function makeBmpBuffer(width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const buffer = Buffer.alloc(14 + 40 + pixelBytes);
  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(14 + 40 + pixelBytes, 2);
  buffer.writeUInt32LE(14 + 40, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(0, 30);
  buffer.writeUInt32LE(pixelBytes, 34);
  return buffer;
}

// --- OOXML MCP end-to-end (no application required) ---
const stateDir = path.join(tempRoot, "state");
const e2eDir = path.join(tempRoot, "e2e");
await fs.mkdir(stateDir, { recursive: true });
await fs.mkdir(e2eDir, { recursive: true });
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
process.on("exit", () => {
  try {
    child.kill();
  } catch {
    // The child may already be gone.
  }
});
const lines = createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;
lines.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message));
  else entry.resolve(message.result);
});
function request(method, params) {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}
async function call(name, args = {}) {
  const result = await request("tools/call", { name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content).slice(0, 300)}`);
  return result.structuredContent;
}

await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "perceptual-audit-smoke", version: "0" } });

const e2eBriefPath = await writeBriefAndPlan(e2eDir);
await writeFigureStyle({
  artifactPath: path.join(stateDir, "deck.pptx"),
  styleId: "main",
  document: { schema: STYLE_SCHEMA_VERSION, style_id: "main", fonts: { family: "Arial" }, enforce: "hard" },
});
await call("powerpoint_new_presentation", {});
await call("powerpoint_add_textbox", {
  slide_index: 1,
  name: "TinyNote",
  text: "Dose response",
  left: 60,
  top: 60,
  width: 240,
  height: 60,
  font_size: 5,
  font_name: "Comic Sans MS",
  font_color: "#666666",
});
const imagePath = path.join(e2eDir, "dot.bmp");
await fs.writeFile(imagePath, makeBmpBuffer(1, 900));
await call("powerpoint_add_image", {
  slide_index: 1,
  name: "Micrograph",
  image_path: imagePath,
  left: 400,
  top: 100,
  width: 200,
  height: 200,
  atomic_raster_unit: true,
  contains_reconstructable_content: false,
  raster_reason: "single atomic micrograph field",
  decomposition_note: "no finer native split is possible",
  source_is_tightly_cropped: true,
});

await check("OOXML audit emits and evaluates a perceptual model through MCP", async () => {
  const audit = await call("powerpoint_audit_figure", {
    slide_index: 1,
    brief_path: e2eBriefPath,
    publisher: "elsevier",
    raster_class: "halftone",
  });
  assert.equal(audit.perceptual_qa.applied, true);
  assert.equal(audit.perceptual_qa.plan_applied.figure_kind, "process");
  assert.equal(audit.perceptual_qa.contexts.length, 1);
  assert.equal(audit.publisher_spec.applied, true);
  const categories = audit.findings.map((finding) => finding.category);
  assert.equal(categories.includes("font_size_below_minimum"), true);
  assert.equal(categories.includes("effective_dpi_below_minimum"), true);
  const fontFinding = audit.findings.find((finding) => finding.category === "font_size_below_minimum");
  assert.equal(fontFinding.shape_name, "TinyNote");
  assert.equal(typeof fontFinding.finding_id, "string");
  assert.equal(fontFinding.status, "new");
  const dpiFinding = audit.findings.find((finding) => finding.category === "effective_dpi_below_minimum");
  assert.equal(dpiFinding.shape_name, "Micrograph");
  assert.equal(dpiFinding.rule_token, "raster.halftone.minimum_dpi");
  assert.deepEqual(audit.perceptual_qa.model.pictures, [
    { name: "Micrograph", pixel_width: 1, pixel_height: 900, placed_width_pt: 200, placed_height_pt: 200 },
  ]);
  const deviation = audit.findings.find((finding) => finding.category === "style_deviation");
  assert.equal(deviation.severity, "hard");
  assert.equal(deviation.token, "fonts.family");
  assert.equal(deviation.expected, "Arial");
  assert.equal(deviation.actual, "Comic Sans MS");
  assert.equal(audit.perceptual_qa.style_applied.revision, 0);
  assert.equal(audit.passed_deterministic_gate, false);
  assert.equal(audit.perceptual_qa.findings_added >= 2, true);
  assert.equal("perceptual_model" in audit, false);
});

await check("MCP perceptual findings respect brief waivers", async () => {
  await writeFigureBrief({
    briefPath: e2eBriefPath,
    expectedRevision: 0,
    document: {
      schema: BRIEF_SCHEMA_VERSION,
      figure_id: "fig",
      profile: "paper-figure",
      recreation_policy: "faithful",
      inventory: [{ id: "t1", kind: "text", text_verbatim: "Tiny" }],
      intentional_deviations: [
        { item: "TinyNote", category: "font_size_below_minimum", reason: "legacy caption kept from the reference figure", approved_by: "user" },
      ],
    },
  });
  const audit = await call("powerpoint_audit_figure", { slide_index: 1, brief_path: e2eBriefPath });
  const waived = audit.findings.find((finding) => finding.category === "font_size_below_minimum");
  assert.equal(waived.status, "waived");
  assert.equal(waived.waive_ref, "TinyNote");
  assert.equal(audit.summary.waived >= 1, true);
  assert.equal(audit.brief_applied.revision, 1);
  const downgraded = audit.findings.find((finding) => finding.category === "style_deviation");
  assert.equal(downgraded.severity, "warning");
  assert.equal(downgraded.policy_downgraded, true);
  assert.equal(audit.passed_deterministic_gate, true);
});

lines.close();
child.kill();
await fs.rm(tempRoot, { recursive: true, force: true });

console.log(`perceptual audit smoke: ${checks} checks passed.`);

// Verifies the P4 alt-text generator (deterministic draft from brief claims +
// inventory + design plan), the reserved brief blocks (accessibility,
// provenance), and the figure_alt_text_generate MCP tool through a real
// server process.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { ALT_TEXT_SCHEMA_VERSION, generateAltText } from "../plugins/scientific-illustrator/scripts/figure-alt-text.mjs";
import { validateBrief } from "../plugins/scientific-illustrator/scripts/figure-truth.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sci-illu-alt-text-"));
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

function makeBrief(overrides = {}) {
  return {
    schema: "scientific-illustrator/brief@1",
    figure_id: "alt-demo",
    profile: "paper-figure",
    figure_kind: "mechanism",
    inventory: [
      { id: "p1", kind: "panel", label: "a" },
      { id: "p2", kind: "panel", label: "b" },
      { id: "t1", kind: "text", text_verbatim: "ER stress" },
      { id: "t2", kind: "text", text_verbatim: "UPR" },
    ],
    claims: [
      { id: "c1", statement: "Nutrient stress activates the integrated stress response.", priority: 1 },
      { id: "c2", statement: "Chaperone levels recover after adaptation", priority: 2 },
    ],
    ...overrides,
  };
}

function makePlan(overrides = {}) {
  return {
    schema: "scientific-illustrator/design-plan@1",
    figure_id: "alt-demo",
    figure_kind: "mechanism",
    archetype: "causal-flow",
    reading_order: "left to right",
    primary_claims: ["c2", "c1"],
    ...overrides,
  };
}

try {
  // ----------------------------------------------------- composition
  await check("a full draft follows the plan order and records its sources", async () => {
    const draft = generateAltText({ brief: makeBrief(), plan: makePlan() });
    assert.equal(draft.schema, ALT_TEXT_SCHEMA_VERSION);
    assert.match(draft.alt_text, /A mechanism diagram organized as a causal-flow layout\./);
    assert.match(draft.alt_text, /Chaperone levels recover after adaptation; Nutrient stress activates the integrated stress response\./);
    assert.match(draft.alt_text, /It is organized into 2 panels labeled a, b\./);
    assert.match(draft.alt_text, /The intended reading order is left to right\./);
    assert.match(draft.alt_text, /Visible text includes "ER stress", "UPR"\./);
    assert.deepEqual(draft.sources.claims_used, ["c2", "c1"]);
    assert.equal(draft.sources.plan_used, true);
    assert.equal(draft.sources.archetype, "causal-flow");
    assert.deepEqual(draft.sources.panels_used, ["p1", "p2"]);
    assert.deepEqual(draft.sources.labels_used, ["ER stress", "UPR"]);
    assert.equal(draft.word_count > 10, true);
    assert.deepEqual(draft.warnings, []);
  });

  await check("vowel-initial kind and archetype phrases take an", () => {
    const draft = generateAltText({
      brief: makeBrief({ figure_kind: "experimental-workflow" }),
      plan: makePlan({ figure_kind: "experimental-workflow", archetype: "iterative" }),
    });
    assert.match(draft.alt_text, /An experimental workflow organized as an iterative layout\./);
    const image = generateAltText({ brief: makeBrief({ figure_kind: "image-panel" }) });
    assert.match(image.alt_text, /An image panel\./);
  });

  await check("terminal punctuation is trimmed before joining statements", async () => {
    const brief = makeBrief({ claims: [{ id: "c1", statement: "Trailing dot." }] });
    const draft = generateAltText({ brief });
    assert.match(draft.alt_text, /Trailing dot\./);
    assert.equal(draft.alt_text.includes("dot.."), false);
  });

  await check("without a plan claims fall back to priority order", async () => {
    const brief = makeBrief({
      claims: [
        { id: "low", statement: "Second priority", priority: 9 },
        { id: "high", statement: "First priority", priority: 1 },
      ],
    });
    const draft = generateAltText({ brief });
    assert.deepEqual(draft.sources.claims_used, ["high", "low"]);
    assert.equal(draft.sources.plan_used, false);
    assert.equal(draft.alt_text.includes("organized as a"), false);
    assert.equal(draft.alt_text.includes("reading order"), false);
  });

  await check("intent.message stands in when the brief has no claims", async () => {
    const brief = makeBrief({ claims: undefined, intent: { message: "Shows the pathway" } });
    const draft = generateAltText({ brief });
    assert.match(draft.alt_text, /Its main message: Shows the pathway\./);
    assert.equal(draft.warnings.some((warning) => warning.includes("no claims")), false);
  });

  await check("a brief without claims or intent warns about the gap", async () => {
    const brief = makeBrief({ claims: undefined, intent: undefined });
    const draft = generateAltText({ brief });
    assert.equal(draft.warnings.some((warning) => warning.includes("no claims and no intent.message")), true);
    assert.equal(draft.sources.claims_used.length, 0);
  });

  await check("claims with no descriptive text are omitted instead of emitting empty sentences", async () => {
    const brief = makeBrief({ claims: [{ id: "empty", statement: "..." }] });
    const draft = generateAltText({ brief });
    assert.equal(draft.alt_text.includes("It shows"), false);
    assert.equal(
      draft.warnings.includes("1 claim(s) had no descriptive text after trimming and were omitted from the draft."),
      true
    );
    assert.deepEqual(draft.sources.claims_used, []);
  });

  await check("punctuation-only claims are dropped from mixed claim lists", async () => {
    const brief = makeBrief({
      claims: [
        { id: "empty", statement: "…" },
        { id: "dash", statement: "——" },
        { id: "real", statement: "Real finding", priority: 2 },
      ],
    });
    const draft = generateAltText({ brief });
    assert.match(draft.alt_text, /It shows Real finding\./);
    assert.equal(draft.alt_text.includes("It shows …"), false);
    assert.deepEqual(draft.sources.claims_used, ["real"]);
    assert.equal(
      draft.warnings.includes("2 claim(s) had no descriptive text after trimming and were omitted from the draft."),
      true
    );
  });

  await check("claim, label, and panel caps are enforced with warnings", async () => {
    const claims = Array.from({ length: 5 }, (_, index) => ({
      id: `c${index}`,
      statement: `Claim number ${index}`,
      priority: index,
    }));
    const labels = Array.from({ length: 9 }, (_, index) => ({ id: `t${index}`, kind: "text", text_verbatim: `Label ${index}` }));
    const panels = Array.from({ length: 10 }, (_, index) => ({ id: `p${index}`, kind: "panel", label: String.fromCharCode(97 + index) }));
    const draft = generateAltText({ brief: makeBrief({ claims, inventory: [...panels, ...labels] }) });
    assert.equal(draft.sources.claims_used.length, 3);
    assert.equal(draft.sources.labels_used.length, 6);
    assert.equal(draft.sources.panels_used.length, 8);
    assert.equal(draft.warnings.some((warning) => warning.includes("max_claims=3")), true);
    assert.equal(draft.warnings.some((warning) => warning.includes("max_labels=6")), true);
    assert.equal(draft.warnings.some((warning) => warning.includes("max_panels=8")), true);
  });

  await check("options override the caps and duplicate labels collapse", async () => {
    const brief = makeBrief({
      inventory: [
        { id: "t1", kind: "text", text_verbatim: "UPR" },
        { id: "t2", kind: "text", text_verbatim: "UPR" },
        { id: "t3", kind: "text", text_verbatim: "ER stress" },
      ],
    });
    const draft = generateAltText({ brief, options: { max_labels: 1 } });
    assert.deepEqual(draft.sources.labels_used, ["UPR"]);
    assert.equal(draft.warnings.some((warning) => warning.includes("max_labels=1")), true);
    const collapsed = generateAltText({ brief: makeBrief({ inventory: [
      { id: "t1", kind: "text", text_verbatim: "UPR" },
      { id: "t2", kind: "text", text_verbatim: "UPR" },
    ] }) });
    assert.deepEqual(collapsed.sources.labels_used, ["UPR"]);
    assert.equal(collapsed.alt_text.split('"UPR"').length - 1, 1);
  });

  await check("unknown kinds fall back to a readable phrase", async () => {
    const draft = generateAltText({ brief: makeBrief({ figure_kind: "custom-weird" }) });
    assert.match(draft.alt_text, /A custom weird figure\./);
  });

  await check("an empty brief still produces a minimal honest draft", async () => {
    const draft = generateAltText({ brief: { schema: "scientific-illustrator/brief@1", figure_id: "x", profile: "diagram", inventory: [] } });
    assert.match(draft.alt_text, /A scientific figure\./);
    assert.equal(draft.warnings.length > 0, true);
  });

  await check("non-object briefs are refused", async () => {
    assert.throws(() => generateAltText({ brief: null }), /brief must be a brief document object/);
    assert.throws(() => generateAltText({}), /brief must be a brief document object/);
  });

  // ----------------------------------------------------- reserved brief blocks
  await check("accessibility.alt_text validates and unknown subkeys warn", async () => {
    const { errors, warnings } = validateBrief(makeBrief({ accessibility: { alt_text: "A draft description." } }));
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
    const empty = validateBrief(makeBrief({ accessibility: { alt_text: "" } }));
    assert.equal(empty.errors.some((error) => error.includes("accessibility.alt_text")), true);
    const extra = validateBrief(makeBrief({ accessibility: { alt_text: "ok", grayscale: true } }));
    assert.deepEqual(extra.errors, []);
    assert.equal(extra.warnings.some((warning) => warning.includes("accessibility.grayscale")), true);
    const wrong = validateBrief(makeBrief({ accessibility: [] }));
    assert.equal(wrong.errors.some((error) => error.includes("accessibility must be an object")), true);
  });

  await check("provenance validates the reserved schema", async () => {
    const valid = validateBrief(
      makeBrief({
        provenance: {
          source_type: "microscopy",
          source_file: "raw/sample-01.tif",
          processing: ["flat-field correction", "crop"],
          crop: "right half of the field",
          license: null,
        },
      })
    );
    assert.deepEqual(valid.errors, []);
    assert.deepEqual(valid.warnings, []);
    const badProcessing = validateBrief(makeBrief({ provenance: { processing: "crop" } }));
    assert.equal(badProcessing.errors.some((error) => error.includes("provenance.processing must be an array")), true);
    const emptyStep = validateBrief(makeBrief({ provenance: { processing: [""] } }));
    assert.equal(emptyStep.errors.some((error) => error.includes("provenance.processing[0]")), true);
    const extra = validateBrief(makeBrief({ provenance: { source_type: "photo", credit: "unknown" } }));
    assert.deepEqual(extra.errors, []);
    assert.equal(extra.warnings.some((warning) => warning.includes("provenance.credit")), true);
    const wrong = validateBrief(makeBrief({ provenance: 42 }));
    assert.equal(wrong.errors.some((error) => error.includes("provenance must be an object")), true);
  });

  // ----------------------------------------------------- MCP wiring
  console.log("MCP tool wiring");
  {
    const mcpDir = path.join(tempRoot, "mcp");
    await fs.mkdir(mcpDir, { recursive: true });
    const artifact = path.join(mcpDir, "alt-demo.pptx");
    const child = spawn(process.execPath, [path.join(root, "plugins", "scientific-illustrator", "scripts", "server.mjs")], {
      stdio: ["pipe", "pipe", "pipe"],
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
      const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "figure-alt-text-smoke", version: "1.0.0" } });

      await check("tools/list exposes figure_alt_text_generate and instructions mention it", async () => {
        const tools = await request("tools/list");
        const names = new Set(tools.tools.map((tool) => tool.name));
        assert.equal(names.has("figure_alt_text_generate"), true);
        const generate = tools.tools.find((tool) => tool.name === "figure_alt_text_generate");
        assert.equal(generate.inputSchema.properties.artifact_path.type, "string");
        assert.equal(typeof init.instructions, "string");
        assert.match(init.instructions, /figure_alt_text_generate/);
      });

      await check("the MCP tool composes a draft from the stored brief and plan", async () => {
        const briefDocument = makeBrief();
        await call("figure_brief_write", { artifact_path: artifact, document: briefDocument });
        const planDocument = makePlan();
        await call("figure_plan_write", { artifact_path: artifact, document: planDocument });
        const draft = await call("figure_alt_text_generate", { artifact_path: artifact });
        assert.match(draft.alt_text, /mechanism diagram/);
        assert.match(draft.alt_text, /"ER stress"/);
        assert.equal(draft.sources.plan_used, true);
        assert.deepEqual(draft.sources.claims_used, ["c2", "c1"]);
      });

      await check("a missing brief fails loudly instead of inventing a draft", async () => {
        await assert.rejects(
          call("figure_alt_text_generate", { artifact_path: path.join(mcpDir, "missing.pptx") }),
          /No figure brief was found/
        );
      });

      await check("an explicit brief_path anchors generation without an artifact path", async () => {
        const explicitBrief = path.join(mcpDir, "custom.si-brief.json");
        await call("figure_brief_write", { brief_path: explicitBrief, document: makeBrief({ figure_id: "alt-brief-anchored" }) });
        await call("figure_plan_write", { brief_path: explicitBrief, document: makePlan({ figure_id: "alt-brief-anchored" }) });
        const draft = await call("figure_alt_text_generate", { brief_path: explicitBrief });
        assert.match(draft.alt_text, /mechanism diagram/);
        assert.equal(draft.sources.plan_used, true);
      });
    } finally {
      lines.close();
      child.kill();
    }
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log(`figure alt text smoke: ${checks} checks passed.`);

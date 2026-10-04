// Encodes the adaptive workflow contract as executable checks instead of relying
// on agents to follow a markdown reference:
//   1. the agent-facing PowerPoint skills must carry the batching, checkpoint,
//      planner, and correction-budget rules and must not regress to the old
//      paced per-region loop;
//   2. the MCP surface must keep zero-delay bounded batches, the planner schema,
//      and equation tooling;
//   3. planner routing must map onto real sequence operations, refuse silent
//      crops, and keep zero-delay bounded execution limits.
// The draw.io skill is intentionally out of scope: its backend still paces
// per-object playback.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { planReconstruction } from "../plugins/scientific-illustrator/scripts/adaptive-planner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFile(path.join(root, relative), "utf8");

// ---------------------------------------------------------------- 1. skill text
const skills = {
  "edit-powerpoint-live": await read("plugins/scientific-illustrator/skills/edit-powerpoint-live/SKILL.md"),
  "recreate-scientific-figure": await read("plugins/scientific-illustrator/skills/recreate-scientific-figure/SKILL.md"),
};
const requiredBySkill = {
  "edit-powerpoint-live": [
    "powerpoint_draw_sequence",
    "step_delay_ms=0",
    "powerpoint_plan_reconstruction",
    "checkpoint",
    "correction attempts",
    "reuse the verified motif",
  ],
  "recreate-scientific-figure": ["zero artificial delay", "bounded batches", "checkpoint"],
};
for (const [skill, tokens] of Object.entries(requiredBySkill)) {
  for (const token of tokens) {
    assert.ok(
      skills[skill].toLowerCase().includes(token.toLowerCase()),
      `${skill} skill is missing the workflow rule "${token}"`,
    );
  }
}
const forbiddenWording = ["nonzero pacing", "mandatory reviewer-corrector", "draw one region at a time"];
for (const [skill, text] of Object.entries(skills)) {
  for (const token of forbiddenWording) {
    assert.ok(
      !text.toLowerCase().includes(token),
      `${skill} skill regressed to the old paced per-region workflow ("${token}")`,
    );
  }
}
console.log("workflow contract: PPT skill text keeps batching/checkpoint/planner rules and drops the paced per-region loop.");

// ------------------------------------------------------------- 2. MCP contract
const child = spawn(process.execPath, [path.join(root, "plugins/scientific-illustrator/scripts/powerpoint-server.mjs")], {
  stdio: ["pipe", "pipe", "pipe"],
});
const lines = createInterface({ input: child.stdout });
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk; });
let nextId = 0;
const pending = new Map();
lines.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  entry.resolve(message);
});
function request(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`timeout ${method}: ${stderr}`)); }, 15000).unref();
  });
}

try {
  const listed = (await request("tools/list", {})).result;
  const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));

  const sequence = byName.get("powerpoint_draw_sequence");
  assert.ok(sequence, "powerpoint_draw_sequence is missing from the MCP surface");
  assert.equal(sequence.inputSchema.properties.step_delay_ms.default, 0, "ordinary drawing must default to zero artificial delay");
  assert.ok(sequence.inputSchema.properties.batch_size, "bounded batch_size is missing from draw_sequence");
  for (const mode of ["per_object", "checkpoint", "fast"]) {
    assert.ok(sequence.inputSchema.properties.pacing_mode.enum.includes(mode), `pacing mode ${mode} is missing`);
  }
  assert.match(sequence.description, /batch/i);
  assert.match(sequence.description, /zero artificial delay/i);

  const planner = byName.get("powerpoint_plan_reconstruction");
  assert.ok(planner, "powerpoint_plan_reconstruction is missing from the MCP surface");
  const kinds = planner.inputSchema.properties.modules.items.properties.kind.enum;
  assert.deepEqual(
    [...kinds].sort(),
    ["chart", "connector", "geometry", "mixed", "organic", "photo", "table", "text", "texture", "unknown"].sort(),
    "planner kind enum drifted from the shared workflow vocabulary",
  );
  assert.ok(planner.inputSchema.required.includes("reference_size") && planner.inputSchema.required.includes("modules"));

  assert.ok(byName.get("powerpoint_add_equation"), "powerpoint_add_equation is missing from the MCP surface");
  console.log("workflow contract: MCP schemas keep zero-delay bounded batches, planner vocabulary, and equation tooling.");
} finally {
  lines.close();
  child.kill();
}

// -------------------------------------------------- 3. planner-to-execution map
const plan = planReconstruction({
  reference_size: { width: 1000, height: 600 },
  modules: [
    { id: "m-text", kind: "text", bbox: { x: 0, y: 0, width: 100, height: 50 }, confidence: 0.9 },
    { id: "m-geometry", kind: "geometry", bbox: { x: 0, y: 60, width: 100, height: 50 }, confidence: 0.9 },
    { id: "m-connector", kind: "connector", bbox: { x: 0, y: 120, width: 100, height: 50 }, confidence: 0.9 },
    { id: "m-chart", kind: "chart", bbox: { x: 0, y: 180, width: 100, height: 50 }, confidence: 0.9, data_available: true },
    { id: "m-table", kind: "table", bbox: { x: 0, y: 240, width: 100, height: 50 }, confidence: 0.9 },
    { id: "m-photo", kind: "photo", bbox: { x: 0, y: 300, width: 100, height: 50 }, confidence: 0.9, source_available: true },
    { id: "m-chart-nodata", kind: "chart", bbox: { x: 0, y: 360, width: 100, height: 50 }, confidence: 0.9 },
    { id: "m-photo-editable", kind: "photo", bbox: { x: 0, y: 420, width: 100, height: 50 }, confidence: 0.9, source_available: true, editable_required: true },
  ],
  max_attempts: 3,
});
const routes = new Map(plan.modules.map((module) => [module.id, module]));
const nativeKinds = ["text", "geometry", "connector", "chart", "table"];
for (const kind of nativeKinds) {
  const route = routes.get(`m-${kind}`);
  assert.equal(route.strategy, "native", `${kind} must route to native editable objects`);
  assert.ok(["draw", "repair", "retain"].includes(route.action), `${kind} produced an unexpected action ${route.action}`);
}
assert.equal(routes.get("m-photo").strategy, "crop", "an atomic photo with a source must route to a bounded crop");
assert.equal(routes.get("m-chart-nodata").strategy, "inspect", "a chart without verified data must inspect instead of inventing values");
assert.equal(routes.get("m-photo-editable").strategy, "inspect", "editable_required must block a silent crop fallback");
assert.equal(plan.execution.step_delay_ms, 0, "planner execution must keep zero artificial delay");
assert.ok([8, 20, 40].includes(plan.execution.max_operations_per_batch), "planner batch limit drifted from the risk map");
assert.equal(plan.requires_visual_review, true, "visual review must remain required");
assert.ok(plan.unresolved_module_ids.includes("m-chart-nodata"), "inspect modules must surface as unresolved ids");
console.log("workflow contract: planner routing maps onto sequence operations, blocks silent crops, and keeps zero-delay bounded execution.");

// Verifies the session discipline counters that make repeated unchanged
// reviews measurable and review debt explicit. Runs against the OOXML backend
// with application sync disabled, so it needs no PowerPoint installation.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "sci-illu-discipline-"));
const child = spawn(process.execPath, [path.join(root, "plugins/scientific-illustrator/scripts/powerpoint-server.mjs")], {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    SCIENTIFIC_ILLUSTRATOR_PPT_HOST: "wps",
    SCIENTIFIC_ILLUSTRATOR_PPT_BACKEND: "ooxml",
    SCIENTIFIC_ILLUSTRATOR_POWERPOINT_SYNC: "0",
    SCIENTIFIC_ILLUSTRATOR_STATE_DIR: temporary,
  },
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
  entry.resolve(message.result);
});
function request(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`timeout ${method}: ${stderr}`)); }, 120000).unref();
  });
}
async function call(name, args = {}) {
  const result = await request("tools/call", { name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content).slice(0, 300)}`);
  return result.structuredContent;
}
const shape = (name, left) => ({ type: "add_shape", slide_index: 1, name, shape: "rectangle", left, top: 10, width: 40, height: 20 });

try {
  await call("powerpoint_new_presentation", {});
  const status0 = await call("powerpoint_status", {});
  assert.equal(status0.discipline.revision, 0, "a fresh deck starts at revision 0");
  assert.equal(status0.discipline.redundant_inspects, 0);
  assert.equal(status0.discipline.stale_review, false);

  const inspectOne = await call("powerpoint_inspect", { max_shapes_per_slide: 1000 });
  assert.equal(inspectOne.discipline.unchanged_since_last_call, false, "the first inspect is never redundant");
  assert.equal(inspectOne.discipline.redundant_inspects, 0);
  assert.equal(inspectOne.discipline.mutations_since_last_inspect, 0);

  const inspectTwo = await call("powerpoint_inspect", { max_shapes_per_slide: 1000 });
  assert.equal(inspectTwo.discipline.unchanged_since_last_call, true, "a second unchanged inspect must be flagged");
  assert.equal(inspectTwo.discipline.redundant_inspects, 1, "the redundant inspect must be counted");

  await call("powerpoint_add_shape", { slide_index: 1, name: "discipline-a", shape: "rectangle", left: 10, top: 10, width: 40, height: 20 });
  const inspectThree = await call("powerpoint_inspect", { max_shapes_per_slide: 1000 });
  assert.equal(inspectThree.discipline.revision, 1, "a mutation must advance the revision");
  assert.equal(inspectThree.discipline.unchanged_since_last_call, false, "an inspect after a mutation is fresh");
  assert.equal(inspectThree.discipline.redundant_inspects, 1);

  const auditOne = await call("powerpoint_audit_figure", { slide_index: 1 });
  assert.equal(auditOne.discipline.mutations_since_last_audit, 0);
  const auditTwo = await call("powerpoint_audit_figure", { slide_index: 1 });
  assert.equal(auditTwo.discipline.unchanged_since_last_call, true, "a repeated unchanged audit must be flagged");
  assert.equal(auditTwo.discipline.redundant_audits, 1);

  await call("powerpoint_add_slide", { position: 2, layout: "blank" });
  const auditSlideOne = await call("powerpoint_audit_figure", { slide_index: 1 });
  assert.equal(auditSlideOne.discipline.unchanged_since_last_call, false, "a different slide is a different scope");
  const auditSlideTwo = await call("powerpoint_audit_figure", { slide_index: 2 });
  assert.equal(auditSlideTwo.discipline.unchanged_since_last_call, false, "a different audit scope is never redundant");
  assert.equal(auditSlideTwo.discipline.redundant_audits, 1, "scope changes must not inflate the redundant count");

  const sequence = await call("powerpoint_draw_sequence", { pacing_mode: "fast", operations: [shape("discipline-b", 100), shape("discipline-c", 150), shape("discipline-d", 200)] });
  assert.equal(sequence.discipline.revision, 5, "batch operations must advance the revision by operations_applied");
  assert.equal(sequence.discipline.mutations_since_last_audit, 3, "review debt after the last audit must be exact");
  assert.equal(sequence.discipline.mutations_since_last_render, 5, "render debt counts every mutation since the last render");
  assert.equal(sequence.discipline.stale_review, true);

  const statusOne = await call("powerpoint_status", {});
  assert.equal(statusOne.discipline.redundant_inspects, 1);
  assert.equal(statusOne.discipline.redundant_audits, 1);
  assert.equal(statusOne.discipline.stale_review, true, "unreviewed mutations must keep the review debt visible");

  console.log("discipline counters: redundant unchanged reviews are counted, scopes are respected, and review debt is exact.");
} finally {
  lines.close();
  child.kill();
  await fs.rm(temporary, { recursive: true, force: true });
}

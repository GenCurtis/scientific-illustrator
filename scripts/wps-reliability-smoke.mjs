import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(root, "plugins/scientific-illustrator/scripts/powerpoint-server.mjs");
const unitPath = path.join(root, "scripts/wps-bridge-unit.py");

async function findPython() {
  const candidates = [
    process.env.SCIENTIFIC_ILLUSTRATOR_PYTHON,
    path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"),
    "python3",
    process.platform === "win32" ? "python.exe" : "/opt/homebrew/bin/python3",
    process.platform === "win32" ? null : "/usr/local/bin/python3",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["-c", "import pptx"], { maxBuffer: 1024 * 1024 });
      return candidate;
    } catch {
      // Continue to the next known Python runtime.
    }
  }
  throw new Error("WPS reliability tests require Python with python-pptx.");
}

function rpcClient(child) {
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  });
  let nextId = 1;
  return {
    async call(method, params = {}) {
      const id = nextId++;
      const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for ${method}. ${stderr}`));
        }, 30000);
        pending.set(id, {
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        });
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return result;
    },
    close() {
      lines.close();
      child.kill();
    },
  };
}

const python = await findPython();
await execFileAsync(python, [unitPath], { cwd: root, maxBuffer: 10 * 1024 * 1024 });

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "scientific-illustrator-wps-test-"));
const child = spawn(process.execPath, [serverPath], {
  cwd: root,
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    SCIENTIFIC_ILLUSTRATOR_PYTHON: python,
    SCIENTIFIC_ILLUSTRATOR_PPT_HOST: "auto",
    SCIENTIFIC_ILLUSTRATOR_PPT_BACKEND: "ooxml",
    SCIENTIFIC_ILLUSTRATOR_STATE_DIR: temporary,
    SCIENTIFIC_ILLUSTRATOR_POWERPOINT_SYNC: "0",
  },
});
const rpc = rpcClient(child);

try {
  await rpc.call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "wps-reliability-smoke", version: "1.0.0" } });
  const listed = await rpc.call("tools/list");
  assert(listed.tools.some((tool) => tool.name === "powerpoint_refresh"));

  const selected = await rpc.call("tools/call", { name: "powerpoint_status", arguments: { host_application: "wps" } });
  assert.equal(selected.isError, undefined);
  assert.equal(selected.structuredContent.target_application, "wps");
  assert.equal(selected.structuredContent.backend_selection.host_preference, "wps");

  const mismatchedSequence = await rpc.call("tools/call", {
    name: "powerpoint_draw_sequence",
    arguments: {
      host_application: "wps",
      step_delay_ms: 0,
      operations: [{
        type: "add_shape", host_application: "powerpoint", slide_index: 1, name: "must-not-dispatch",
        shape: "rectangle", left: 10, top: 10, width: 20, height: 10,
      }],
    },
  });
  assert.equal(mismatchedSequence.isError, true);
  assert.match(mismatchedSequence.content[0].text, /sequence target is wps/i);

  const created = await rpc.call("tools/call", { name: "powerpoint_new_presentation", arguments: {} });
  assert.equal(created.isError, undefined);

  const parallelAdds = await Promise.all(["parallel-a", "parallel-b"].map((name, index) => rpc.call("tools/call", {
    name: "powerpoint_add_shape",
    arguments: {
      slide_index: 1, name, shape: "rectangle", left: 10 + index * 30, top: 5, width: 20, height: 10,
      pause_after_ms: 0, defer_refresh: true,
    },
  })));
  assert(parallelAdds.every((result) => result.isError === undefined));
  const parallelInventory = await rpc.call("tools/call", { name: "powerpoint_inspect", arguments: { max_slides: 1, max_shapes_per_slide: 20 } });
  const parallelNames = new Set(parallelInventory.structuredContent.slides[0].shapes.map((shape) => shape.shape_name));
  assert(parallelNames.has("parallel-a") && parallelNames.has("parallel-b"));

  const operations = Array.from({ length: 25 }, (_, index) => ({
    type: "add_shape",
    slide_index: 1,
    name: `checkpoint-shape-${index + 1}`,
    shape: "rectangle",
    left: 10 + index,
    top: 10 + index,
    width: 20,
    height: 12,
  }));
  const sequence = await rpc.call("tools/call", { name: "powerpoint_draw_sequence", arguments: { operations, step_delay_ms: 0 } });
  assert.equal(sequence.isError, undefined, JSON.stringify(sequence));
  assert.equal(sequence.structuredContent.backend, "ooxml");
  assert.equal(sequence.structuredContent.pacing_mode, "checkpoint");
  assert.equal(sequence.structuredContent.object_operations_applied, 25);
  assert.equal(sequence.structuredContent.file_refresh_count, 3);
  assert.deepEqual(sequence.structuredContent.file_refreshes.map((item) => item.after_operation_count), [10, 20, 25]);

  const status = await rpc.call("tools/call", { name: "powerpoint_status", arguments: { host_application: "wps" } });
  assert.equal(status.isError, undefined);
  assert.equal(status.structuredContent.target_application, "wps");
  assert.equal(status.structuredContent.microsoft_powerpoint_used, false);
  assert.equal(status.structuredContent.managed_file_exists, true);
  assert.equal(status.structuredContent.active_presentation, false);
  assert.equal(status.structuredContent.backend_selection.locked_host, "wps");

  const wrongHost = await rpc.call("tools/call", { name: "powerpoint_status", arguments: { host_application: "powerpoint" } });
  assert.equal(wrongHost.isError, true);
  assert.match(wrongHost.content[0].text, /locked to wps/i);
} finally {
  rpc.close();
  await fs.rm(temporary, { recursive: true, force: true });
}

console.log("WPS discovery, truthful status, failed-open handling, and checkpoint refresh tests passed.");

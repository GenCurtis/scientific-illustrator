import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const servers = [
  {
    file: "plugins/scientific-illustrator/scripts/live-server.mjs",
    tools: ["drawio_live_status", "drawio_live_get_capabilities", "drawio_live_add_table", "drawio_live_add_chart", "drawio_live_audit_figure"],
  },
  {
    file: "plugins/scientific-illustrator/scripts/server.mjs",
    tools: ["drawio_validate", "drawio_inspect", "drawio_export"],
  },
  {
    file: "plugins/scientific-illustrator/scripts/powerpoint-server.mjs",
    tools: ["powerpoint_status", "powerpoint_officejs_status", "powerpoint_set_backend", "powerpoint_set_focus_policy", "powerpoint_refresh", "powerpoint_get_capabilities", "powerpoint_add_table", "powerpoint_add_chart", "powerpoint_audit_figure", "powerpoint_save"],
    call: { name: "powerpoint_officejs_status", arguments: { wait_for_connection_ms: 0 } },
  },
];

async function testServer(server) {
  const child = spawn(process.execPath, [path.join(root, server.file)], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  const responses = new Map();
  const expectedResponseCount = server.call ? 3 : 2;
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out: ${server.file}\n${stderr}`)), 8000);
    lines.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (message.id === 1 || message.id === 2 || (server.call && message.id === 3)) responses.set(message.id, message);
        if (responses.size === expectedResponseCount) {
          clearTimeout(timer);
          resolve();
        }
      } catch (error) {
        clearTimeout(timer);
        reject(new Error(`Invalid MCP JSON from ${server.file}: ${error.message}`));
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (responses.size < expectedResponseCount) reject(new Error(`${server.file} exited early with ${code}. ${stderr}`));
    });
  });

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke-test", version: "1.0.0" } } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  if (server.call) child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: server.call })}\n`);

  try {
    await completed;
    if (responses.get(1)?.error) throw new Error(JSON.stringify(responses.get(1).error));
    const tools = responses.get(2)?.result?.tools;
    if (!Array.isArray(tools) || tools.length === 0) throw new Error(`${server.file} returned no tools.`);
    const names = new Set(tools.map((tool) => tool.name));
    const missing = server.tools.filter((name) => !names.has(name));
    if (missing.length) throw new Error(`${server.file} is missing tools: ${missing.join(", ")}`);
    if (server.call) {
      if (responses.get(3)?.error || responses.get(3)?.result?.isError) throw new Error(`${server.file} probe call failed: ${JSON.stringify(responses.get(3))}`);
      if (responses.get(3)?.result?.structuredContent?.backend !== "officejs-context-sync") throw new Error(`${server.file} returned an unexpected Office.js bridge status.`);
    }
    console.log(`${server.file}: ${tools.length} tools; required parity tools present`);
  } finally {
    lines.close();
    child.kill();
  }
}

for (const server of servers) await testServer(server);
console.log("MCP smoke tests passed.");

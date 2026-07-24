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
    tools: ["powerpoint_status", "powerpoint_get_capabilities", "powerpoint_add_table", "powerpoint_add_chart", "powerpoint_audit_figure", "powerpoint_save"],
  },
];

async function testServer(server) {
  const child = spawn(process.execPath, [path.join(root, server.file)], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  const responses = new Map();
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out: ${server.file}\n${stderr}`)), 8000);
    lines.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (message.id === 1 || message.id === 2) responses.set(message.id, message);
        if (responses.size === 2) {
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
      if (responses.size < 2) reject(new Error(`${server.file} exited early with ${code}. ${stderr}`));
    });
  });

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke-test", version: "1.0.0" } } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);

  try {
    await completed;
    if (responses.get(1)?.error) throw new Error(JSON.stringify(responses.get(1).error));
    const tools = responses.get(2)?.result?.tools;
    if (!Array.isArray(tools) || tools.length === 0) throw new Error(`${server.file} returned no tools.`);
    const names = new Set(tools.map((tool) => tool.name));
    const missing = server.tools.filter((name) => !names.has(name));
    if (missing.length) throw new Error(`${server.file} is missing tools: ${missing.join(", ")}`);
    console.log(`${server.file}: ${tools.length} tools; required parity tools present`);
  } finally {
    lines.close();
    child.kill();
  }
}

for (const server of servers) await testServer(server);
console.log("MCP smoke tests passed.");

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(root, "plugins/scientific-illustrator/scripts/powerpoint-server.mjs");
const pythonBridgePath = path.join(root, "plugins/scientific-illustrator/scripts/powerpoint-mac-bridge.py");
const comBridgePath = path.join(root, "plugins/scientific-illustrator/scripts/powerpoint-bridge.ps1");

const [serverSource, pythonSource, comSource] = await Promise.all([
  fs.readFile(serverPath, "utf8"),
  fs.readFile(pythonBridgePath, "utf8"),
  fs.readFile(comBridgePath, "utf8"),
]);

for (const [label, source, required] of [
  ["PowerPoint MCP", serverSource, ["powerpoint_set_focus_policy", "SCIENTIFIC_ILLUSTRATOR_FOCUS_POLICY", "focus_policy: focusPolicy"]],
  ["OOXML bridge", pythonSource, ['common = ["-g"] if focus_policy == "preserve" else []', "SW_SHOWNOACTIVATE", 'focus_policy="foreground"', "document_open_verified"]],
  ["Windows COM bridge", comSource, ['$ForceForeground -or $script:FocusPolicy -eq "foreground"', "Restore-ForegroundWindow", 'Show-Slide $application $index $true']],
]) {
  const missing = required.filter((fragment) => !source.includes(fragment));
  if (missing.length) throw new Error(`${label} is missing focus-preservation safeguards: ${missing.join(", ")}`);
}

const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
const lines = createInterface({ input: child.stdout });
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });

const responses = new Map();
const completed = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Focus-policy MCP test timed out. ${stderr}`)), 8000);
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if ([1, 2, 3, 4, 5].includes(message.id)) responses.set(message.id, message);
      if (responses.size === 5) {
        clearTimeout(timer);
        resolve();
      }
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
  child.once("error", reject);
  child.once("exit", (code) => {
    if (responses.size < 5) reject(new Error(`PowerPoint MCP exited early with ${code}. ${stderr}`));
  });
});

const write = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
write({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "focus-policy-smoke", version: "1.0.0" } } });
write({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
write({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "powerpoint_set_focus_policy", arguments: { focus_policy: "preserve" } } });
write({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "powerpoint_set_focus_policy", arguments: { focus_policy: "foreground" } } });
write({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "powerpoint_set_focus_policy", arguments: { focus_policy: "preserve" } } });

try {
  await completed;
  const tools = responses.get(2)?.result?.tools || [];
  if (!tools.some((tool) => tool.name === "powerpoint_set_focus_policy")) throw new Error("Focus-policy MCP tool is not listed.");
  if (responses.get(3)?.result?.structuredContent?.focus_policy !== "preserve") throw new Error("Preserve policy was not acknowledged.");
  if (responses.get(4)?.result?.structuredContent?.focus_policy !== "foreground") throw new Error("Foreground policy was not acknowledged.");
  if (responses.get(5)?.result?.structuredContent?.focus_policy !== "preserve") throw new Error("Focus policy could not return to preserve.");
} finally {
  lines.close();
  child.kill();
}

console.log("Cross-platform presentation focus-policy safeguards passed.");

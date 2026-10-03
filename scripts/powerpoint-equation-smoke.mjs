import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptDir = path.join(root, "plugins", "scientific-illustrator", "scripts");
const bridge = path.join(scriptDir, "powerpoint-mac-bridge.py");
const converter = path.join(scriptDir, "latex_to_omml.py");

function skipped(reason) {
  console.log(`SKIP powerpoint OOXML equation smoke: ${reason}`);
  process.exit(0);
}

const candidates = [
  { executable: process.env.SCIENTIFIC_ILLUSTRATOR_PYTHON, args: [] },
  { executable: path.join(scriptDir, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python3"), args: [] },
  { executable: process.platform === "win32" ? "python.exe" : "python3", args: [] },
  { executable: process.platform === "win32" ? "py.exe" : "/usr/local/bin/python3", args: process.platform === "win32" ? ["-3"] : [] },
].filter((candidate) => candidate.executable);

let python = null;
for (const candidate of candidates) {
  try {
    await execFileAsync(candidate.executable, [...candidate.args, "-c", "import pptx, latex2mathml"], { encoding: "utf8" });
    python = candidate;
    break;
  } catch {
    // try the next interpreter
  }
}
if (!python) skipped("no Python interpreter with python-pptx and latex2mathml is installed");

const latex = String.raw`\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`;
let omml = "";
try {
  const { stdout } = await execFileAsync(
    python.executable,
    [...python.args, converter, "--json-b64", Buffer.from(latex, "utf8").toString("base64")],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).pop());
  if (!parsed.ok) skipped(parsed.error);
  omml = String(parsed.omml || "");
} catch (error) {
  skipped(String(error.stderr || error.message || error).trim().split("\n").pop());
}
if (!omml.includes("<m:oMath")) throw new Error("the LaTeX converter did not return an <m:oMath> element");

const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "scientific-illustrator-equation-"));
async function bridgeCall(action, args) {
  const payload = Buffer.from(JSON.stringify({ action, arguments: args }), "utf8").toString("base64");
  const { stdout } = await execFileAsync(python.executable, [...python.args, bridge, payload], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      SCIENTIFIC_ILLUSTRATOR_STATE_DIR: stateDir,
      SCIENTIFIC_ILLUSTRATOR_FOCUS_POLICY: "preserve",
      SCIENTIFIC_ILLUSTRATOR_DEFER_REFRESH: "1",
      SCIENTIFIC_ILLUSTRATOR_POWERPOINT_SYNC: "0",
    },
  });
  return JSON.parse(stdout.trim());
}

await bridgeCall("new_presentation", { focus_policy: "preserve" });
const state = JSON.parse(await fs.readFile(path.join(stateDir, "session.json"), "utf8"));
const deck = String(state.path);
const result = await bridgeCall("add_equation", {
  slide_index: 1,
  name: "eq_smoke",
  latex,
  omml_b64: Buffer.from(omml, "utf8").toString("base64"),
  left: 80,
  top: 80,
  width: 420,
  height: 80,
});
if (result.equation !== true) throw new Error(`add_equation did not report a native equation: ${JSON.stringify(result)}`);

const verifyScript = [
  "import json, sys, zipfile",
  "from pptx import Presentation",
  "path = sys.argv[1]",
  "Presentation(path)",
  "with zipfile.ZipFile(path) as archive:",
  "    xml = archive.read('ppt/slides/slide1.xml').decode('utf-8')",
  "print(json.dumps({'equations': xml.count('<a14:m'), 'oMath': '<m:oMath' in xml}))",
].join("\n");
const verifyPath = path.join(stateDir, "verify-equation.py");
await fs.writeFile(verifyPath, verifyScript, "utf8");
const { stdout: verifyOut } = await execFileAsync(python.executable, [...python.args, verifyPath, deck], { encoding: "utf8" });
const verify = JSON.parse(verifyOut.trim());
if (verify.equations !== 1 || !verify.oMath) throw new Error(`OOXML equation verification failed: ${JSON.stringify(verify)}`);

console.log(`powerpoint OOXML equation smoke passed: saved deck contains 1 native <a14:m> math zone (${path.basename(deck)}).`);

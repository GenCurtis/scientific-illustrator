import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bridge = path.join(root, "plugins", "scientific-illustrator", "scripts", "powerpoint-mac-bridge.py");

const candidates = [
  { executable: process.env.SCIENTIFIC_ILLUSTRATOR_PYTHON, args: [] },
  {
    executable: path.join(
      os.homedir(),
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "python",
      process.platform === "win32" ? "python.exe" : "bin/python3",
    ),
    args: [],
  },
  { executable: process.platform === "win32" ? "python.exe" : "python3", args: [] },
  { executable: process.platform === "win32" ? "py.exe" : "/opt/homebrew/bin/python3", args: process.platform === "win32" ? ["-3"] : [] },
  { executable: process.platform === "win32" ? null : "/usr/local/bin/python3", args: [] },
].filter((candidate) => candidate.executable);

const failures = [];
for (const candidate of candidates) {
  try {
    await execFileAsync(candidate.executable, [...candidate.args, "-m", "py_compile", bridge], {
      cwd: root,
      maxBuffer: 1024 * 1024,
    });
    console.log(`Python bridge syntax passed with ${candidate.executable}${candidate.args.length ? ` ${candidate.args.join(" ")}` : ""}.`);
    process.exit(0);
  } catch (error) {
    failures.push(`${candidate.executable}: ${String(error.message || error).split("\n")[0]}`);
  }
}

throw new Error(`No usable Python 3 runtime could compile the OOXML bridge. Checked: ${failures.join("; ")}`);

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  drawioExecutableCandidates,
  resolveDrawioExecutable,
} from "../plugins/scientific-illustrator/scripts/drawio-path.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const windowsEnvironment = {
  ProgramFiles: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
  LOCALAPPDATA: "C:\\Users\\Researcher\\AppData\\Local",
};
const windowsExpected = "C:\\Users\\Researcher\\AppData\\Local\\Programs\\draw.io\\draw.io.exe";
const windowsCandidates = drawioExecutableCandidates({
  platform: "win32",
  env: windowsEnvironment,
  homeDir: "C:\\Users\\Researcher",
});
assert(windowsCandidates.includes("C:\\Program Files\\draw.io\\draw.io.exe"));
assert(windowsCandidates.includes(windowsExpected));
assert.deepEqual(
  resolveDrawioExecutable({
    platform: "win32",
    env: windowsEnvironment,
    homeDir: "C:\\Users\\Researcher",
    exists: (candidate) => candidate === windowsExpected,
  }),
  { executable: windowsExpected, source: "auto-detected" },
);

const macExpected = "/Users/researcher/Applications/draw.io.app/Contents/MacOS/draw.io";
assert.deepEqual(
  resolveDrawioExecutable({
    platform: "darwin",
    env: {},
    homeDir: "/Users/researcher",
    exists: (candidate) => candidate === macExpected,
  }),
  { executable: macExpected, source: "auto-detected" },
);
assert.deepEqual(
  resolveDrawioExecutable({
    platform: "win32",
    env: { DRAWIO_PATH: "~\\Tools\\draw.io.exe" },
    homeDir: "C:\\Users\\Researcher",
    exists: () => false,
  }),
  { executable: "C:\\Users\\Researcher\\Tools\\draw.io.exe", source: "DRAWIO_PATH" },
);
assert.deepEqual(
  resolveDrawioExecutable({ platform: "win32", env: {}, homeDir: "C:\\Users\\Researcher", exists: () => false }),
  { executable: "draw.io.exe", source: "PATH fallback" },
);

if (process.platform === "win32") {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  const systemPowerShell = systemRoot && path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const powershell = systemPowerShell && existsSync(systemPowerShell) ? systemPowerShell : "powershell.exe";
  const { stdout } = await execFileAsync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", "windows-compat-smoke.ps1")],
    { cwd: root, maxBuffer: 10 * 1024 * 1024 },
  );
  process.stdout.write(stdout);
}

console.log(`draw.io discovery paths passed for Windows and macOS; native compatibility checks passed on ${process.platform}.`);

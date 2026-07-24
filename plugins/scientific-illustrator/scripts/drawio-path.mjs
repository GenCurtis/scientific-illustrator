import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function expandHome(value) {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith(`~${path.sep}`) || value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function absoluteCandidates() {
  if (process.platform === "win32") {
    return [
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, "draw.io", "draw.io.exe"),
      process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "draw.io", "draw.io.exe"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "draw.io", "draw.io.exe"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "draw.io", "draw.io.exe"),
    ].filter(Boolean);
  }

  if (process.platform === "darwin") {
    return [
      "/Applications/draw.io.app/Contents/MacOS/draw.io",
      path.join(os.homedir(), "Applications", "draw.io.app", "Contents", "MacOS", "draw.io"),
    ];
  }

  return ["/usr/bin/drawio", "/usr/local/bin/drawio", "/snap/bin/drawio", "/opt/drawio/drawio"];
}

export function resolveDrawioExecutable() {
  const configured = expandHome(process.env.DRAWIO_PATH?.trim());
  if (configured) return { executable: configured, source: "DRAWIO_PATH" };

  for (const candidate of absoluteCandidates()) {
    if (existsSync(candidate)) return { executable: candidate, source: "auto-detected" };
  }

  return {
    executable: process.platform === "win32" ? "draw.io.exe" : "drawio",
    source: "PATH fallback",
  };
}

export function drawioInstallHint() {
  return "Install the draw.io desktop app from https://www.drawio.com/ or set DRAWIO_PATH to its executable.";
}

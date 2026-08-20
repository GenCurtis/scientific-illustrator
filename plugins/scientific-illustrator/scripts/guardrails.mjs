// Shared defensive guardrails for the Scientific Illustrator MCP servers.
// Single source of truth for the plugin version and the local file-access limits.
// Imported by every server so the same rules cannot drift between backends.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(SCRIPT_DIR, "..");

// The package.json at the repository root is the single version source; the
// servers and the Office manifest must match it (validated in validate-repo.mjs).
const VERSION = JSON.parse(
  await fs.readFile(path.resolve(PLUGIN_DIR, "..", "..", "package.json"), "utf8")
).version;

// Fail closed on a malformed limit instead of silently disabling the guard.
const MAX_IMAGE_BYTES = (() => {
  const raw = String(process.env.SCIENTIFIC_ILLUSTRATOR_MAX_IMAGE_BYTES || "").trim();
  if (!raw) return 64 * 1024 * 1024;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`SCIENTIFIC_ILLUSTRATOR_MAX_IMAGE_BYTES must be a positive integer (got "${raw}").`);
  }
  return value;
})();

function allowedRoot() {
  const raw = process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT;
  if (!raw || !String(raw).trim()) return null;
  return path.resolve(expandHome(String(raw).trim()));
}

function expandHome(filePath) {
  if (typeof filePath !== "string" || !filePath.startsWith("~")) return filePath;
  if (filePath === "~" || filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

function isWithinRoot(resolved, root) {
  const sep = path.sep;
  const base = root.endsWith(sep) ? root.slice(0, -sep.length) : root;
  const a = resolved;
  const b = base;
  if (process.platform === "win32") {
    return a.toLowerCase() === b.toLowerCase() || a.toLowerCase().startsWith(`${b.toLowerCase()}${sep}`);
  }
  return a === b || a.startsWith(`${b}${sep}`);
}

// Restricts every file argument to a configured root directory. When unset the
// previous behavior (any absolute path) is preserved for backward compatibility.
// This check is lexical only; call assertAllowedRealPath before touching the disk
// so a symlink inside the root cannot redirect an I/O operation outside it.
function assertAllowedPath(filePath) {
  const root = allowedRoot();
  const resolved = path.resolve(expandHome(filePath));
  if (!root) return resolved;
  if (!isWithinRoot(resolved, root)) {
    throw new Error(
      `Path is outside the configured SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT (${root}): ${resolved}`
    );
  }
  return resolved;
}

// Realpath of the nearest existing ancestor defeats symlink-based escape: a
// symlink placed inside the root that points outside is rejected instead of
// silently read through. Missing tail components are re-appended lexically, so
// paths under a not-yet-created directory still work after the parent mkdir.
async function assertAllowedRealPath(filePath) {
  const resolved = assertAllowedPath(filePath);
  const root = allowedRoot();
  if (!root) return resolved;
  let probe = resolved;
  const missing = [];
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      const effective = missing.length ? path.resolve(real, ...missing.reverse()) : real;
      if (!isWithinRoot(effective, root)) {
        throw new Error(
          `Path escapes the configured SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT (${root}) after resolving symlinks: ${resolved}`
        );
      }
      return effective;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(probe);
      if (parent === probe) throw error;
      missing.push(path.basename(probe));
      probe = parent;
    }
  }
}

// Magic-byte detection so an arbitrary file renamed to .png/.jpg/.svg cannot be
// embedded as an image. Returns a mime type or null when the content does not
// match the declared extension.
function sniffImageMime(buffer, extension) {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 6 && buffer.subarray(0, 4).toString("ascii") === "GIF8") {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (extension === ".svg") {
    const head = buffer.subarray(0, 8192).toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase();
    const hasSvgRoot = /^<svg[\s>]/.test(head) || (/^<\?xml/.test(head) && /<svg[\s>]/.test(head));
    if (hasSvgRoot) return "image/svg+xml";
  }
  return null;
}

async function atomicWrite(target, data, mode) {
  const dir = path.dirname(target);
  const parent = await assertAllowedRealPath(dir);
  await fs.mkdir(parent, { recursive: true });
  const tmp = path.join(parent, `.${path.basename(target)}.${process.pid}.${Date.now().toString(36)}.tmp`);
  await fs.writeFile(tmp, data, mode);
  await fs.rename(tmp, path.join(parent, path.basename(target)));
}

export { VERSION, MAX_IMAGE_BYTES, allowedRoot, assertAllowedPath, assertAllowedRealPath, sniffImageMime, atomicWrite };
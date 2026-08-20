// Shared defensive guardrails for the Scientific Illustrator MCP servers.
// Single source of truth for the plugin version and the local file-access limits.
// Imported by every server so the same rules cannot drift between backends.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(SCRIPT_DIR, "..");

// The package.json at the repository root is the single version source; the
// servers and the Office manifest must match it (validated in validate-repo.mjs).
const VERSION = JSON.parse(
  await fs.readFile(path.resolve(PLUGIN_DIR, "..", "..", "package.json"), "utf8")
).version;

const MAX_IMAGE_BYTES = Number(
  process.env.SCIENTIFIC_ILLUSTRATOR_MAX_IMAGE_BYTES || 64 * 1024 * 1024
);

function allowedRoot() {
  const raw = process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT;
  if (!raw || !String(raw).trim()) return null;
  return path.resolve(String(raw).trim());
}

// Restricts every file argument to a configured root directory. When unset the
// previous behavior (any absolute path) is preserved for backward compatibility.
function assertAllowedPath(filePath) {
  const root = allowedRoot();
  const resolved = path.resolve(filePath);
  if (!root) return resolved;
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(
      `Path is outside the configured SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT (${root}): ${resolved}`
    );
  }
  return resolved;
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
    const text = buffer.toString("utf8").trimStart().toLowerCase();
    if (text.startsWith("<svg") || text.startsWith("<?xml") || text.includes("<svg")) {
      return "image/svg+xml";
    }
  }
  return null;
}

async function atomicWrite(target, data, mode) {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now().toString(36)}.tmp`);
  await fs.writeFile(tmp, data, mode);
  await fs.rename(tmp, target);
}

export { VERSION, MAX_IMAGE_BYTES, allowedRoot, assertAllowedPath, sniffImageMime, atomicWrite };
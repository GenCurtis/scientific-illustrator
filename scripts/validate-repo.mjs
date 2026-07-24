import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const marketplacePath = path.join(root, ".agents", "plugins", "marketplace.json");
const marketplace = JSON.parse(await fs.readFile(marketplacePath, "utf8"));

if (marketplace.name !== "scientific-illustrator-tools") throw new Error("Unexpected marketplace name.");
if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length !== 1) {
  throw new Error("Marketplace must expose exactly one plugin.");
}

const entry = marketplace.plugins[0];
if (entry.source?.source !== "local") throw new Error("Marketplace source must be local.");
if (entry.policy?.installation !== "AVAILABLE" || entry.policy?.authentication !== "ON_INSTALL") {
  throw new Error("Marketplace policy is incomplete.");
}

const pluginRoot = path.resolve(path.dirname(marketplacePath), "..", "..", entry.source.path);
const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
const mcpPath = path.join(pluginRoot, ".mcp.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const mcp = JSON.parse(await fs.readFile(mcpPath, "utf8"));

if (entry.name !== manifest.name || manifest.name !== "scientific-illustrator") {
  throw new Error("Marketplace and manifest plugin names differ.");
}
if (manifest.version !== "1.3.0") throw new Error("Unexpected public release version.");
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
  throw new Error("Manifest version is not valid semantic versioning.");
}
if (manifest.repository !== "https://github.com/icebird1998/scientific-illustrator") {
  throw new Error("Manifest repository URL is incorrect.");
}
if (manifest.author?.name !== "科研up主:进击的土博" || manifest.interface?.developerName !== "科研up主:进击的土博") {
  throw new Error("Developer attribution is missing.");
}
if (!Array.isArray(manifest.interface?.defaultPrompt) || manifest.interface.defaultPrompt.length > 3) {
  throw new Error("Default prompts are invalid.");
}
if (manifest.interface.defaultPrompt.some((prompt) => [...prompt].length > 128)) {
  throw new Error("A default prompt exceeds 128 characters.");
}

const requiredServers = ["drawio-live", "drawio-file-utils", "powerpoint-live"];
for (const server of requiredServers) {
  const definition = mcp.mcpServers?.[server];
  if (!definition || definition.command !== "node" || !Array.isArray(definition.args)) {
    throw new Error(`Required MCP server is missing or invalid: ${server}`);
  }
  for (const argument of definition.args.filter((value) => value.endsWith(".mjs"))) {
    await fs.access(path.resolve(pluginRoot, argument));
  }
}

const requiredSkills = [
  "audit-scientific-figure",
  "correct-scientific-figure",
  "design-scientific-figure",
  "edit-powerpoint-live",
  "recreate-scientific-figure",
  "recreate-scientific-figure-in-drawio",
];
for (const skill of requiredSkills) {
  await fs.access(path.join(pluginRoot, "skills", skill, "SKILL.md"));
  await fs.access(path.join(pluginRoot, "skills", skill, "agents", "openai.yaml"));
}

async function collectFiles(directory) {
  const files = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await collectFiles(fullPath));
    else files.push(fullPath);
  }
  return files;
}

for (const file of await collectFiles(pluginRoot)) {
  const text = await fs.readFile(file, "utf8");
  if (/C:\\Users\\[^\\]+|C:\/Users\/[^/]+|ProgramData\\miniconda3|gho_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+/i.test(text)) {
    throw new Error(`Local path or credential-like value found in ${path.relative(root, file)}.`);
  }
  if (/\[TODO:[^\]]*\]/i.test(text)) throw new Error(`TODO placeholder found in ${path.relative(root, file)}.`);
}

console.log("Repository structure, attribution, portability, and plugin metadata checks passed.");

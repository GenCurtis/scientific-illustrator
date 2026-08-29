// Agent Config and Manifest Validation Smoke Test
// Verifies that OpenCode and Antigravity configuration examples and skills adhere to open standards.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function checkOpencodeConfig() {
  const file = path.join(root, "opencode.json.example");
  const raw = await fs.readFile(file, "utf8");
  const config = JSON.parse(raw);
  assert.ok(config.mcp, "opencode.json.example missing mcp key");
  assert.ok(config.mcp["powerpoint-live"], "opencode.json.example missing powerpoint-live server");
  assert.ok(config.mcp["drawio-live"], "opencode.json.example missing drawio-live server");
  assert.ok(config.mcp["drawio-file-utils"], "opencode.json.example missing drawio-file-utils server");
  
  for (const [name, srv] of Object.entries(config.mcp)) {
    assert.equal(srv.type, "local");
    const scriptRel = srv.command[1];
    const scriptPath = path.join(root, scriptRel);
    const stat = await fs.stat(scriptPath);
    assert.ok(stat.isFile(), `Target script for ${name} does not exist: ${scriptRel}`);
  }
}

async function checkAntigravityConfig() {
  const file = path.join(root, "mcp_config.json.example");
  const raw = await fs.readFile(file, "utf8");
  const config = JSON.parse(raw);
  assert.ok(config.mcpServers, "mcp_config.json.example missing mcpServers key");
  assert.ok(config.mcpServers["powerpoint-live"], "mcp_config.json.example missing powerpoint-live server");
  assert.ok(config.mcpServers["drawio-live"], "mcp_config.json.example missing drawio-live server");
  assert.ok(config.mcpServers["drawio-file-utils"], "mcp_config.json.example missing drawio-file-utils server");
  
  for (const [name, srv] of Object.entries(config.mcpServers)) {
    assert.equal(srv.command, "node");
    const scriptRel = srv.args[0];
    const scriptPath = path.join(root, scriptRel);
    const stat = await fs.stat(scriptPath);
    assert.ok(stat.isFile(), `Target script for ${name} does not exist: ${scriptRel}`);
  }
}

async function checkSkillsValidity() {
  const skillsDir = path.join(root, "plugins", "scientific-illustrator", "skills");
  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  const skillDirs = entries.filter((e) => e.isDirectory());
  assert.equal(skillDirs.length, 6, "Expected exactly 6 scientific-illustrator skills");
  
  for (const dir of skillDirs) {
    const skillMd = path.join(skillsDir, dir.name, "SKILL.md");
    const content = await fs.readFile(skillMd, "utf8");
    assert.ok(content.startsWith("---"), `${dir.name}/SKILL.md missing frontmatter`);
    const parts = content.split("---");
    assert.ok(parts.length >= 3, `${dir.name}/SKILL.md malformed frontmatter`);
    assert.match(parts[1], new RegExp(`name:\\s*${dir.name}`));
    assert.match(parts[1], /description:/);
  }
}

await checkOpencodeConfig();
await checkAntigravityConfig();
await checkSkillsValidity();

console.log("Agent integration configs (OpenCode, Antigravity) and skills verified successfully.");

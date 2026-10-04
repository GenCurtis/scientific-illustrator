// Verifies the P1a Figure Intelligence knowledge surface: the bundled
// figure-kind grammar pages (template sections, taxonomy coverage), the
// profile quality-rule pages (no publisher numbers — that layer is separate),
// the retrieval functions (readFigureKind / readProfileKnowledge), and the
// MCP tools figure_kind_get / figure_profile_get through a real server
// process.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { KNOWN_FIGURE_KINDS, KNOWN_PROFILES } from "../plugins/scientific-illustrator/scripts/figure-truth.mjs";
import { readFigureKind, readProfileKnowledge } from "../plugins/scientific-illustrator/scripts/figure-knowledge.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kindsDirectory = path.join(root, "plugins", "scientific-illustrator", "references", "figure-kinds");
const profilesDirectory = path.join(root, "plugins", "scientific-illustrator", "references", "profiles");
const KIND_SECTIONS = [
  "## 适用与识别信号",
  "## semantic primitives",
  "## layout archetypes",
  "## 编码约定",
  "## 常见失败模式",
  "## 与其他 kind 的边界",
];

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok - ${name}`);
}

try {
  // ----------------------------------------------------- bundled documents
  await check("the figure-kinds directory matches the taxonomy exactly", async () => {
    const files = (await fs.readdir(kindsDirectory)).filter((name) => name.endsWith(".md"));
    const expected = KNOWN_FIGURE_KINDS.map((kind) => `${kind}.md`);
    assert.deepEqual([...files].sort(), [...expected].sort());
  });

  await check("every kind page carries the full template", async () => {
    for (const kind of KNOWN_FIGURE_KINDS) {
      const source = await fs.readFile(path.join(kindsDirectory, `${kind}.md`), "utf8");
      assert.ok(source.startsWith(`# kind: ${kind}`), `${kind} must declare its kind`);
      for (const heading of KIND_SECTIONS) {
        assert.ok(source.includes(heading), `${kind} is missing section "${heading}"`);
      }
      assert.ok(source.length > 800, `${kind} page is suspiciously short`);
    }
  });

  await check("every profile page carries the quality checklist", async () => {
    for (const profile of KNOWN_PROFILES) {
      const source = await fs.readFile(path.join(profilesDirectory, `${profile}.md`), "utf8");
      assert.ok(source.startsWith(`# profile: ${profile}`), `${profile} must declare its profile`);
      assert.ok(source.includes("## 质量检查清单"), `${profile} is missing the quality checklist`);
      assert.ok(source.includes("## 常见失败模式"), `${profile} is missing failure modes`);
      assert.ok(source.includes("## Recreation policy interplay"), `${profile} is missing the policy section`);
    }
  });

  await check("profile pages keep publisher numbers out (separate compliance layer)", async () => {
    // Heuristic numeric guard for the §6.2 boundary: profile pages must not
    // hard-code publisher/venue numbers in any common notation. The unit
    // patterns below are intentionally broad because a missed variant would
    // silently reintroduce the numbers this layer deliberately excludes.
    const NUMBER_PATTERNS = [
      /\b\d{2,4}\s*dpi\b/i,
      /dots?[\s-]*per[\s-]*inch/i,
      /\b\d+(?:\.\d+)?\s*(?:pt|point|px)\b/i,
      /\b\d+(?:\.\d+)?\s*mm\b/i,
      /\b\d+(?:\.\d+)?\s*cm\b/i,
      /\b\d+(?:\.\d+)?\s*in\b(?![\w-])/i,
      /\b\d+\s*[×x]\s*\d+\b/i,
    ];
    for (const profile of KNOWN_PROFILES) {
      const source = await fs.readFile(path.join(profilesDirectory, `${profile}.md`), "utf8");
      for (const pattern of NUMBER_PATTERNS) {
        assert.ok(!pattern.test(source), `${profile} must not hard-code numeric specs (matched ${pattern})`);
      }
    }
  });

  // ----------------------------------------------------- retrieval functions
  await check("readFigureKind returns the bundled page for every kind", async () => {
    for (const kind of KNOWN_FIGURE_KINDS) {
      const result = readFigureKind(kind);
      assert.equal(result.kind, kind);
      assert.equal(result.source, `references/figure-kinds/${kind}.md`);
      assert.ok(result.markdown.includes(`# kind: ${kind}`));
    }
  });

  await check("readFigureKind refuses unknown kinds and bad input", async () => {
    assert.throws(() => readFigureKind("mechanisim"), /not one of the known figure kinds/);
    assert.throws(() => readFigureKind(""), /non-empty string/);
    assert.throws(() => readFigureKind(42), /non-empty string/);
  });

  await check("readProfileKnowledge combines quality rules and default parameters", async () => {
    for (const profile of KNOWN_PROFILES) {
      const result = readProfileKnowledge(profile);
      assert.equal(result.profile, profile);
      assert.equal(result.quality_rules.source, `references/profiles/${profile}.md`);
      assert.ok(result.quality_rules.markdown.includes(`# profile: ${profile}`));
      assert.equal(result.source, "references/profiles/defaults.json");
      assert.equal(typeof result.parameters, "object");
    }
  });

  await check("readProfileKnowledge refuses unknown profiles and bad input", async () => {
    assert.throws(() => readProfileKnowledge("journal-cover"), /not one of the known profiles/);
    assert.throws(() => readProfileKnowledge("   "), /non-empty string/);
    assert.throws(() => readProfileKnowledge(null), /non-empty string/);
  });

  await check("paper-figure knowledge keeps the loose machine defaults", async () => {
    const result = readProfileKnowledge("paper-figure");
    assert.equal(result.parameters.min_font_pt.default, 7);
    assert.deepEqual(result.parameters.journal, {});
  });

  await check("server source wires the knowledge tools and instructions", async () => {
    const source = await fs.readFile(path.join(root, "plugins", "scientific-illustrator", "scripts", "server.mjs"), "utf8");
    assert.ok(source.includes('name: "figure_kind_get"'));
    assert.ok(source.includes("readFigureKind(args.kind)"));
    assert.ok(source.includes("readProfileKnowledge(args.profile)"));
    assert.ok(source.includes("figure_kind_get returns the grammar page"));
  });

  // ----------------------------------------------------- MCP wiring
  console.log("MCP tool wiring");
  {
    const child = spawn(process.execPath, [path.join(root, "plugins", "scientific-illustrator", "scripts", "server.mjs")], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: child.stdout });
    let stderr = "";
    let nextId = 0;
    const pending = new Map();
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    lines.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      entry.resolve(message.result);
    });
    async function request(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
        setTimeout(() => {
          if (pending.delete(id)) reject(new Error(`timeout ${method}: ${stderr}`));
        }, 30000).unref();
      });
    }
    async function call(name, args = {}) {
      const result = await request("tools/call", { name, arguments: args });
      if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content).slice(0, 300)}`);
      return result.structuredContent;
    }

    try {
      await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "figure-knowledge-smoke", version: "1.0.0" },
      });

      await check("tools/list exposes figure_kind_get and figure_profile_get", async () => {
        const tools = await request("tools/list");
        const names = new Set(tools.tools.map((tool) => tool.name));
        assert.ok(names.has("figure_kind_get"), "missing figure_kind_get");
        assert.ok(names.has("figure_profile_get"), "missing figure_profile_get");
      });

      await check("figure_kind_get returns the mechanism grammar through MCP", async () => {
        const result = await call("figure_kind_get", { kind: "mechanism" });
        assert.equal(result.source, "references/figure-kinds/mechanism.md");
        assert.ok(result.markdown.includes("inhibition"));
        assert.ok(result.markdown.includes("## 常见失败模式"));
      });

      await check("figure_kind_get surfaces unknown kinds as isError", async () => {
        const result = await request("tools/call", { name: "figure_kind_get", arguments: { kind: "nope" } });
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /not one of the known figure kinds/);
      });

      await check("figure_profile_get returns quality rules plus parameters through MCP", async () => {
        const result = await call("figure_profile_get", { profile: "slides" });
        assert.equal(result.quality_rules.source, "references/profiles/slides.md");
        assert.ok(result.quality_rules.markdown.includes("## 质量检查清单"));
        assert.equal(result.parameters.aspect.default, "16:9");
        assert.equal(result.source, "references/profiles/defaults.json");
      });

      await check("figure_profile_get surfaces unknown profiles as isError", async () => {
        const result = await request("tools/call", { name: "figure_profile_get", arguments: { profile: "journal-cover" } });
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /not one of the known profiles/);
      });
    } finally {
      lines.close();
      child.kill();
    }
  }

  console.log(`\nfigure knowledge smoke: ${checks} checks passed.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

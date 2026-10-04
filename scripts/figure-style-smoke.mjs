// Verifies the P0d style contract and profile defaults: style schema
// validation, filename-safe style ids, three-level style resolution, the
// optimistic-locking lifecycle, identity mismatch refusal, the machine-
// readable profile defaults, and the new MCP tool surface
// (figure_style_read/figure_style_write/figure_profile_get) plus the brief
// recreation_gate contract through a real server process.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  STYLE_SCHEMA_VERSION,
  normalizeStyleId,
  readFigureStyle,
  validateStyle,
  writeFigureStyle,
} from "../plugins/scientific-illustrator/scripts/figure-style.mjs";
import { KNOWN_PROFILES, readProfileDefaults } from "../plugins/scientific-illustrator/scripts/figure-truth.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sci-illu-style-"));
let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok - ${name}`);
}

function makeStyle(overrides = {}) {
  return {
    schema: STYLE_SCHEMA_VERSION,
    style_id: "main",
    palette: { primary: "#2166AC", accent: "#B2182B", categorical: ["#1B7837", "#762A83"] },
    fonts: { family: "Arial", sizes_pt: { body: 7 } },
    lines: { stroke_pt: 0.75 },
    ...overrides,
  };
}

try {
  // ----------------------------------------------------- style validation
  await check("a minimal style document passes", async () => {
    const { errors, warnings } = validateStyle(makeStyle());
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  await check("the style schema version is enforced", async () => {
    const { errors } = validateStyle(makeStyle({ schema: "scientific-illustrator/style@2" }));
    assert.equal(errors.some((error) => error.includes("schema must be")), true);
  });

  await check("style_id is required", async () => {
    const { errors } = validateStyle(makeStyle({ style_id: "" }));
    assert.equal(errors.some((error) => error.includes("style_id")), true);
  });

  await check("enforce only accepts advisory or hard", async () => {
    assert.deepEqual(validateStyle(makeStyle({ enforce: "hard" })).errors, []);
    assert.equal(validateStyle(makeStyle({ enforce: "always" })).errors.some((error) => error.includes("enforce")), true);
  });

  await check("theme blocks must be objects", async () => {
    const { errors } = validateStyle(makeStyle({ palette: ["#fff"] }));
    assert.equal(errors.some((error) => error.includes("palette must be an object")), true);
  });

  await check("applicable_profiles validates membership", async () => {
    assert.deepEqual(validateStyle(makeStyle({ applicable_profiles: ["paper-figure", "graphical-abstract"] })).errors, []);
    const { errors, warnings } = validateStyle(makeStyle({ applicable_profiles: ["paper-figure", "unknown-profile"] }));
    assert.deepEqual(errors, []);
    assert.equal(warnings.some((warning) => warning.includes("unknown-profile")), true);
  });

  await check("full visual-system blocks are structurally accepted", async () => {
    const full = makeStyle({
      spacing: { unit: "mm", gutter: 3 },
      panel_gutter: 3,
      shape_language: "rounded-rectangles",
      corner_radius: 4,
      connector_style: { style: "orthogonal", routing: "avoid-crossings" },
      arrowheads: "solid-triangle",
      callout_style: { fill: "#F7F7F7" },
      annotation_style: "minimal",
      marker_shapes: { control: "circle", treatment: "square" },
      image_border: "hairline",
      scale_bar_style: { color: "#000000", thickness: 1 },
      legend_style: "top-right",
      uncertainty_style: { kind: "ci95" },
      semantic_styles: {
        control: { color: "#666666", marker: "circle", line_style: "solid" },
        "treatment-a": { color: "#0072B2", marker: "square" },
      },
    });
    assert.deepEqual(validateStyle(full).errors, []);
    assert.deepEqual(validateStyle(full).warnings, []);
  });

  await check("loose visual-system blocks reject garbage types", async () => {
    for (const [field, value] of [
      ["spacing", ["mm"]],
      ["panel_gutter", null],
      ["shape_language", ""],
      ["shape_language", "   "],
      ["corner_radius", Number.NaN],
      ["arrowheads", true],
      ["marker_shapes", []],
    ]) {
      const { errors } = validateStyle(makeStyle({ [field]: value }));
      assert.equal(errors.some((error) => error.includes(field)), true, `${field} must reject ${JSON.stringify(value)}`);
    }
  });

  await check("semantic_styles entries validate their identity-to-visual contract", async () => {
    assert.deepEqual(validateStyle(makeStyle({ semantic_styles: {} })).errors, []);
    assert.deepEqual(
      validateStyle(makeStyle({ semantic_styles: { control: { color: "#666666", marker: "circle", line_style: "solid" } } })).errors,
      []
    );
    assert.equal(
      validateStyle(makeStyle({ semantic_styles: ["control"] })).errors.some((error) => error.includes("semantic_styles must be an object")),
      true
    );
    assert.equal(
      validateStyle(makeStyle({ semantic_styles: { control: "grey" } })).errors.some((error) => error.includes("semantic_styles.control must be an object")),
      true
    );
    assert.equal(
      validateStyle(makeStyle({ semantic_styles: { control: {} } })).errors.some((error) => error.includes("must declare at least one")),
      true
    );
    assert.equal(
      validateStyle(makeStyle({ semantic_styles: { control: { color: "" } } })).errors.some((error) => error.includes("control.color")),
      true
    );
    for (const badValue of [5, true, null]) {
      assert.equal(
        validateStyle(makeStyle({ semantic_styles: { control: { color: badValue } } })).errors.some((error) => error.includes("control.color")),
        true,
        `semantic_styles values must reject ${JSON.stringify(badValue)}`
      );
    }
    for (const badIdentity of ["", "   "]) {
      assert.equal(
        validateStyle(makeStyle({ semantic_styles: { [badIdentity]: { color: "#000000" } } })).errors.some((error) =>
          error.includes("keys must be non-empty")
        ),
        true,
        "semantic_styles identities must be non-empty"
      );
    }
    const { errors, warnings } = validateStyle(makeStyle({ semantic_styles: { control: { color: "#666666", dash: "long" } } }));
    assert.deepEqual(errors, []);
    assert.equal(warnings.some((warning) => warning.includes("control.dash")), true);
  });

  await check("unknown style fields are preserved and warned", async () => {
    const { errors, warnings } = validateStyle(makeStyle({ bevel_style: 2 }));
    assert.deepEqual(errors, []);
    assert.equal(warnings.some((warning) => warning.includes("bevel_style")), true);
  });

  await check("style ids must be filename-safe", async () => {
    assert.equal(normalizeStyleId("main"), "main");
    assert.equal(normalizeStyleId(" thesis-2026 "), "thesis-2026");
    assert.throws(() => normalizeStyleId("a/b"), /filename-safe/);
    assert.throws(() => normalizeStyleId(".."), /filename-safe/);
    assert.throws(() => normalizeStyleId(""), /non-empty string/);
    assert.throws(() => normalizeStyleId(5), /non-empty string/);
  });

  // ----------------------------------------------------- lifecycle (sibling)
  const siblingArtifact = path.join(tempRoot, "sibling", "fig.pptx");
  await check("write creates a sibling style with revision 0", async () => {
    const result = await writeFigureStyle({ artifactPath: siblingArtifact, document: makeStyle() });
    assert.equal(result.created, true);
    assert.equal(result.revision, 0);
    assert.equal(result.resolution_basis, "sibling");
    assert.equal(result.resolved_path, path.join(tempRoot, "sibling", "main.si-style.json"));
  });

  await check("read returns the stored style", async () => {
    const read = await readFigureStyle({ artifactPath: siblingArtifact });
    assert.equal(read.exists, true);
    assert.equal(read.document.palette.primary, "#2166AC");
    assert.equal(read.revision, 0);
  });

  await check("updates require expected_revision", async () => {
    await assert.rejects(
      writeFigureStyle({ artifactPath: siblingArtifact, document: makeStyle() }),
      /already exists .*expected_revision=0/
    );
  });

  await check("creation refuses a non-zero expected_revision", async () => {
    await assert.rejects(
      writeFigureStyle({ artifactPath: path.join(tempRoot, "lock", "fresh.pptx"), expectedRevision: 7, document: makeStyle() }),
      /expected_revision must be 0/
    );
  });

  await check("an existing style with a different schema is refused", async () => {
    const artifact = path.join(tempRoot, "schema-guard", "fig.pptx");
    await writeFigureStyle({ artifactPath: artifact, document: makeStyle() });
    const target = path.join(tempRoot, "schema-guard", "main.si-style.json");
    const stored = JSON.parse(await fs.readFile(target, "utf8"));
    stored.schema = "scientific-illustrator/style@2";
    await fs.writeFile(target, JSON.stringify(stored));
    await assert.rejects(
      writeFigureStyle({ artifactPath: artifact, expectedRevision: 0, document: makeStyle() }),
      /refusing to overwrite across schema versions/
    );
  });

  await check("a stale expected_revision fails loudly", async () => {
    await assert.rejects(
      writeFigureStyle({ artifactPath: siblingArtifact, expectedRevision: 7, document: makeStyle() }),
      /does not match the current revision 0/
    );
  });

  await check("an update increments the revision and keeps created_at", async () => {
    const first = await readFigureStyle({ artifactPath: siblingArtifact });
    const updated = await writeFigureStyle({
      artifactPath: siblingArtifact,
      expectedRevision: 0,
      document: makeStyle({ fonts: { family: "Helvetica" } }),
    });
    assert.equal(updated.created, false);
    assert.equal(updated.revision, 1);
    const second = await readFigureStyle({ artifactPath: siblingArtifact });
    assert.equal(second.document.fonts.family, "Helvetica");
    assert.equal(second.document.created_at, first.document.created_at);
  });

  await check("a style_id mismatch is refused on write", async () => {
    await assert.rejects(
      writeFigureStyle({ artifactPath: path.join(tempRoot, "sibling", "other.pptx"), styleId: "main", document: makeStyle({ style_id: "other" }) }),
      /does not match the requested style_id/
    );
  });

  await check("a missing style reports exists=false instead of failing", async () => {
    const read = await readFigureStyle({ artifactPath: path.join(tempRoot, "missing", "none.pptx") });
    assert.equal(read.exists, false);
    assert.equal(read.document, null);
  });

  // ----------------------------------------------------- discovery
  await check("project discovery stores styles under .scientific-illustrator/styles/", async () => {
    const projectDir = path.join(tempRoot, "proj");
    await fs.mkdir(path.join(projectDir, ".scientific-illustrator"), { recursive: true });
    const artifact = path.join(projectDir, "figures", "fig3.pptx");
    const result = await writeFigureStyle({ artifactPath: artifact, document: makeStyle() });
    assert.equal(result.resolution_basis, "project");
    assert.equal(result.resolved_path, path.join(projectDir, ".scientific-illustrator", "styles", "main.json"));
    const read = await readFigureStyle({ artifactPath: artifact, styleId: "main" });
    assert.equal(read.exists, true);
    assert.equal(read.document.style_id, "main");
  });

  await check("an explicit style_path wins and skips the identity check without style_id", async () => {
    const explicit = path.join(tempRoot, "explicit", "thesis.si-style.json");
    await writeFigureStyle({ stylePath: explicit, document: makeStyle({ style_id: "thesis" }) });
    const read = await readFigureStyle({ stylePath: explicit });
    assert.equal(read.resolution_basis, "explicit");
    assert.equal(read.document.style_id, "thesis");
    await assert.rejects(readFigureStyle({ stylePath: explicit, styleId: "main" }), /declares style_id "thesis"/);
  });

  await check("a mismatch between requested id and explicit file is refused", async () => {
    const explicit = path.join(tempRoot, "explicit", "thesis.si-style.json");
    await assert.rejects(
      writeFigureStyle({ stylePath: explicit, styleId: "other", document: makeStyle({ style_id: "other" }), expectedRevision: 0 }),
      /declares style_id|does not match/
    );
  });

  await check("invalid style documents are refused before writing", async () => {
    await assert.rejects(
      writeFigureStyle({ artifactPath: path.join(tempRoot, "sibling", "bad.pptx"), document: makeStyle({ enforce: "always" }) }),
      /enforce/
    );
  });

  // ----------------------------------------------------- profile defaults
  await check("every known profile exposes machine-readable defaults", async () => {
    for (const profile of KNOWN_PROFILES) {
      const result = readProfileDefaults(profile);
      assert.equal(result.profile, profile);
      assert.equal(result.source, "references/profiles/defaults.json");
      assert.equal(typeof result.parameters, "object");
    }
  });

  await check("paper-figure exposes the loose default parameters", async () => {
    const result = readProfileDefaults("paper-figure");
    assert.equal(result.parameters.min_font_pt.default, 7);
    assert.equal(result.parameters.column_class.default, "single");
    assert.deepEqual(result.parameters.journal, {});
  });

  await check("an unknown profile is refused", async () => {
    assert.throws(() => readProfileDefaults("journal-cover"), /not one of the known profiles/);
    assert.throws(() => readProfileDefaults(""), /non-empty string/);
  });

  await check("a broken defaults file degrades without crashing brief validation", async () => {
    const sandbox = path.join(tempRoot, "defaults-degrade");
    const scriptsDir = path.join(sandbox, "plugins", "scientific-illustrator", "scripts");
    const refsDir = path.join(sandbox, "plugins", "scientific-illustrator", "references", "profiles");
    await fs.mkdir(scriptsDir, { recursive: true });
    await fs.mkdir(refsDir, { recursive: true });
    await fs.writeFile(path.join(sandbox, "package.json"), JSON.stringify({ version: "sandbox" }));
    const pluginScripts = path.join(root, "plugins", "scientific-illustrator", "scripts");
    await fs.copyFile(path.join(pluginScripts, "guardrails.mjs"), path.join(scriptsDir, "guardrails.mjs"));
    await fs.copyFile(path.join(pluginScripts, "figure-truth.mjs"), path.join(scriptsDir, "figure-truth.mjs"));
    await fs.writeFile(path.join(refsDir, "defaults.json"), '{ "schema": "scientific-illustrator/profile-defaults@1", "profiles": ');
    await fs.writeFile(
      path.join(sandbox, "probe.mjs"),
      [
        'import { readProfileDefaults, validateBrief } from "./plugins/scientific-illustrator/scripts/figure-truth.mjs";',
        'const brief = { schema: "scientific-illustrator/brief@1", figure_id: "x", profile: "paper-figure", inventory: [], profile_settings: { min_font_size: 6 } };',
        "let validateThrew = null;",
        "let warningCount = null;",
        "try { warningCount = validateBrief(brief).warnings.length; } catch (error) { validateThrew = error.message; }",
        "let readThrew = null;",
        'try { readProfileDefaults("paper-figure"); } catch (error) { readThrew = error.message; }',
        "console.log(JSON.stringify({ validateThrew, warningCount, readThrew }));",
      ].join("\n")
    );
    const run = spawnSync(process.execPath, [path.join(sandbox, "probe.mjs")], { encoding: "utf8", timeout: 30000 });
    assert.equal(run.status, 0, run.stderr);
    const parsed = JSON.parse(run.stdout.trim());
    assert.equal(parsed.validateThrew, null, "validateBrief must survive a broken defaults file");
    assert.equal(parsed.warningCount, 0, "the advisory parameter check must degrade silently");
    assert.match(parsed.readThrew, /unavailable or invalid/, "explicit reads must fail loudly");
  });

  // ----------------------------------------------------- MCP wiring
  console.log("MCP tool wiring");
  {
    const mcpDir = path.join(tempRoot, "mcp");
    await fs.mkdir(mcpDir, { recursive: true });
    const artifact = path.join(mcpDir, "deck.pptx");
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
      await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "figure-style-smoke", version: "1.0.0" } });

      await check("tools/list exposes the style and profile tools", async () => {
        const tools = await request("tools/list");
        const names = new Set(tools.tools.map((tool) => tool.name));
        for (const name of ["figure_style_read", "figure_style_write", "figure_profile_get", "figure_brief_read", "figure_brief_write"]) {
          assert.ok(names.has(name), `missing tool ${name}`);
        }
      });

      await check("figure_style_write creates a sibling style through MCP", async () => {
        const result = await call("figure_style_write", {
          artifact_path: artifact,
          document: makeStyle({ semantic_styles: { control: { color: "#666666", marker: "circle" } } }),
        });
        assert.equal(result.created, true);
        assert.equal(result.revision, 0);
        assert.equal(result.resolved_path, path.join(mcpDir, "main.si-style.json"));
      });

      await check("figure_style_read returns the stored document through MCP", async () => {
        const result = await call("figure_style_read", { artifact_path: artifact });
        assert.equal(result.exists, true);
        assert.equal(result.document.style_id, "main");
        assert.equal(result.document.palette.primary, "#2166AC");
        assert.equal(result.document.semantic_styles.control.marker, "circle");
      });

      await check("figure_profile_get returns profile defaults through MCP", async () => {
        const result = await call("figure_profile_get", { profile: "poster" });
        assert.equal(result.parameters.orientation.default, "portrait");
        assert.equal(result.parameters.min_font_pt.default, 24);
      });

      await check("figure_profile_get surfaces unknown profiles as isError", async () => {
        const result = await request("tools/call", { name: "figure_profile_get", arguments: { profile: "nope" } });
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /not one of the known profiles/);
      });

      await check("figure_brief_write returns the recreation gate through MCP", async () => {
        const result = await call("figure_brief_write", {
          artifact_path: artifact,
          document: {
            schema: "scientific-illustrator/brief@1",
            figure_id: "deck",
            profile: "slides",
            inventory: [],
            recreation_policy: "publication-ready",
            source_ambiguities: [{ severity: "semantic", question: "which dataset is the control?" }],
          },
        });
        assert.equal(result.recreation_gate.policy, "publication-ready");
        assert.equal(result.recreation_gate.blocking.length, 1);
      });
    } finally {
      lines.close();
      child.kill();
    }
  }

  console.log(`\nfigure style smoke: ${checks} checks passed.`);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

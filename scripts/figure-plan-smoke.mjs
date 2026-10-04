// Verifies the P1b design plan: the design-plan@1 schema validation, the
// regenerable lifecycle (optimistic locking, tool-managed revision and
// timestamps), the three-level resolution plus the brief-anchored derivation,
// allowed-root confinement, and the MCP tool surface
// (figure_plan_read / figure_plan_write) through a real server process.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  PLAN_SCHEMA_VERSION,
  derivePlanPathFromBrief,
  readFigurePlan,
  resolvePlanTarget,
  validatePlan,
  writeFigurePlan,
} from "../plugins/scientific-illustrator/scripts/figure-plan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sci-illu-plan-"));
let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok - ${name}`);
}

function makePlan(overrides = {}) {
  return {
    schema: PLAN_SCHEMA_VERSION,
    figure_id: "fig3-carbon-cycle",
    figure_kind: "process",
    archetype: "cyclic-process",
    reading_order: "clockwise",
    primary_claims: ["c1"],
    encoding: { reservoir: "rounded-container", flux: "directed-connector" },
    hierarchy: { primary: ["c1", "ocean"], secondary: ["soil"] },
    layout_constraints: { avoid_connector_crossing: true, minimum_panel_gutter_mm: 3 },
    render_contexts: ["publication", "screen", "thumbnail"],
    ...overrides,
  };
}

try {
  // ----------------------------------------------------- validation
  await check("a minimal plan passes without warnings", async () => {
    const { errors, warnings } = validatePlan(makePlan());
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  await check("the design-plan schema version is enforced", async () => {
    const { errors } = validatePlan(makePlan({ schema: "scientific-illustrator/design-plan@2" }));
    assert.equal(errors.some((error) => error.includes("schema must be")), true);
  });

  await check("figure_id, figure_kind, and archetype are required", async () => {
    for (const field of ["figure_id", "figure_kind", "archetype"]) {
      const { errors } = validatePlan(makePlan({ [field]: "" }));
      assert.equal(errors.some((error) => error.includes(field)), true, `${field} must be required`);
    }
  });

  await check("an unknown figure_kind warns but stays forward-compatible", async () => {
    const { errors, warnings } = validatePlan(makePlan({ figure_kind: "timeline" }));
    assert.deepEqual(errors, []);
    assert.equal(warnings.some((warning) => warning.includes("figure_kind")), true);
  });

  await check("encoding values must be non-empty strings", async () => {
    assert.equal(validatePlan(makePlan({ encoding: { flux: "" } })).errors.some((error) => error.includes("encoding.flux")), true);
    assert.equal(validatePlan(makePlan({ encoding: { flux: { style: "dashed" } } })).errors.some((error) => error.includes("encoding.flux")), true);
    assert.equal(validatePlan(makePlan({ encoding: ["x"] })).errors.some((error) => error.includes("encoding must be an object")), true);
  });

  await check("hierarchy accepts primary/secondary id arrays and warns on extra tiers", async () => {
    assert.deepEqual(validatePlan(makePlan({ hierarchy: { primary: ["a"], secondary: [] } })).errors, []);
    assert.equal(validatePlan(makePlan({ hierarchy: { primary: "a" } })).errors.some((error) => error.includes("hierarchy.primary")), true);
    const { warnings } = validatePlan(makePlan({ hierarchy: { primary: ["a"], tertiary: ["b"] } }));
    assert.equal(warnings.some((warning) => warning.includes("hierarchy.tertiary")), true);
  });

  await check("layout constraints validate their known fields", async () => {
    assert.deepEqual(validatePlan(makePlan({ layout_constraints: { avoid_connector_crossing: false } })).errors, []);
    assert.equal(
      validatePlan(makePlan({ layout_constraints: { avoid_connector_crossing: "yes" } })).errors.some((error) => error.includes("avoid_connector_crossing")),
      true
    );
    assert.equal(
      validatePlan(makePlan({ layout_constraints: { minimum_panel_gutter_mm: -1 } })).errors.some((error) => error.includes("minimum_panel_gutter_mm")),
      true
    );
    const { warnings } = validatePlan(makePlan({ layout_constraints: { avoid_connector_crossing: true, custom: 1 } }));
    assert.equal(warnings.some((warning) => warning.includes("layout_constraints.custom")), true);
  });

  await check("render contexts validate membership with warnings", async () => {
    assert.deepEqual(validatePlan(makePlan({ render_contexts: ["publication", "thumbnail"] })).errors, []);
    const { errors, warnings } = validatePlan(makePlan({ render_contexts: ["publication", "billboard"] }));
    assert.deepEqual(errors, []);
    assert.equal(warnings.some((warning) => warning.includes("billboard")), true);
    assert.equal(validatePlan(makePlan({ render_contexts: "publication" })).errors.some((error) => error.includes("render_contexts must be an array")), true);
  });

  await check("primary_claims rejects non-strings and warns on duplicates", async () => {
    assert.equal(validatePlan(makePlan({ primary_claims: ["c1", 5] })).errors.some((error) => error.includes("primary_claims[1]")), true);
    const { warnings } = validatePlan(makePlan({ primary_claims: ["c1", "c1"] }));
    assert.equal(warnings.some((warning) => warning.includes("duplicated")), true);
  });

  await check("unknown top-level fields warn and extensions stay silent", async () => {
    const { errors, warnings } = validatePlan(makePlan({ inventory: [] }));
    assert.deepEqual(errors, []);
    assert.equal(warnings.some((warning) => warning.includes("inventory")), true);
    assert.deepEqual(validatePlan(makePlan({ extensions: { note: "x" } })).warnings, []);
  });

  await check("revision, extensions, reading_order, and gutter keep their types", async () => {
    assert.equal(validatePlan(makePlan({ revision: -1 })).errors.some((error) => error.includes("revision")), true);
    assert.equal(validatePlan(makePlan({ revision: 1.5 })).errors.some((error) => error.includes("revision")), true);
    assert.equal(validatePlan(makePlan({ extensions: [] })).errors.some((error) => error.includes("extensions")), true);
    assert.equal(validatePlan(makePlan({ reading_order: "" })).errors.some((error) => error.includes("reading_order")), true);
    assert.equal(
      validatePlan(makePlan({ layout_constraints: { minimum_panel_gutter_mm: Number.NaN } })).errors.some((error) =>
        error.includes("minimum_panel_gutter_mm")
      ),
      true
    );
  });

  // ----------------------------------------------------- lifecycle (sibling)
  const siblingArtifact = path.join(tempRoot, "sibling", "fig.pptx");
  await check("write creates a sibling plan with revision 0", async () => {
    const result = await writeFigurePlan({ artifactPath: siblingArtifact, document: makePlan() });
    assert.equal(result.created, true);
    assert.equal(result.revision, 0);
    assert.equal(result.resolution_basis, "sibling");
    assert.equal(result.resolved_path, path.join(tempRoot, "sibling", "fig.si-plan.json"));
  });

  await check("read returns the stored plan", async () => {
    const read = await readFigurePlan({ artifactPath: siblingArtifact });
    assert.equal(read.exists, true);
    assert.equal(read.document.archetype, "cyclic-process");
    assert.equal(read.revision, 0);
  });

  await check("updates require expected_revision and increment it", async () => {
    await assert.rejects(writeFigurePlan({ artifactPath: siblingArtifact, document: makePlan() }), /already exists .*expected_revision=0/);
    const updated = await writeFigurePlan({
      artifactPath: siblingArtifact,
      expectedRevision: 0,
      document: makePlan({ archetype: "reservoir-flux" }),
    });
    assert.equal(updated.created, false);
    assert.equal(updated.revision, 1);
    const read = await readFigurePlan({ artifactPath: siblingArtifact });
    assert.equal(read.document.archetype, "reservoir-flux");
  });

  await check("creation refuses a non-zero expected_revision", async () => {
    await assert.rejects(
      writeFigurePlan({ artifactPath: path.join(tempRoot, "lock", "fresh.pptx"), expectedRevision: 7, document: makePlan() }),
      /expected_revision must be 0/
    );
  });

  await check("a stale expected_revision fails loudly", async () => {
    await assert.rejects(
      writeFigurePlan({ artifactPath: siblingArtifact, expectedRevision: 7, document: makePlan() }),
      /does not match the current revision 1/
    );
  });

  await check("provided created_at and revision are tool-managed and warned", async () => {
    const result = await writeFigurePlan({
      artifactPath: siblingArtifact,
      expectedRevision: 1,
      document: makePlan({ created_at: "1999-01-01T00:00:00.000Z", revision: 42 }),
    });
    assert.equal(result.revision, 2);
    assert.equal(result.schema_warnings.some((warning) => warning.includes("created_at")), true);
    assert.equal(result.schema_warnings.some((warning) => warning.includes("revision")), true);
    const read = await readFigurePlan({ artifactPath: siblingArtifact });
    assert.notEqual(read.document.created_at, "1999-01-01T00:00:00.000Z");
  });

  await check("an existing plan with a different schema is refused", async () => {
    const artifact = path.join(tempRoot, "schema-guard", "fig.pptx");
    await writeFigurePlan({ artifactPath: artifact, document: makePlan() });
    const target = path.join(tempRoot, "schema-guard", "fig.si-plan.json");
    const stored = JSON.parse(await fs.readFile(target, "utf8"));
    stored.schema = "scientific-illustrator/design-plan@2";
    await fs.writeFile(target, JSON.stringify(stored));
    await assert.rejects(
      writeFigurePlan({ artifactPath: artifact, expectedRevision: 0, document: makePlan() }),
      /refusing to overwrite across schema versions/
    );
  });

  await check("an existing plan with an invalid revision is refused", async () => {
    const artifact = path.join(tempRoot, "revision-guard", "fig.pptx");
    await writeFigurePlan({ artifactPath: artifact, document: makePlan() });
    const target = path.join(tempRoot, "revision-guard", "fig.si-plan.json");
    const stored = JSON.parse(await fs.readFile(target, "utf8"));
    delete stored.revision;
    await fs.writeFile(target, JSON.stringify(stored));
    await assert.rejects(
      writeFigurePlan({ artifactPath: artifact, expectedRevision: 0, document: makePlan() }),
      /invalid or missing revision/
    );
  });

  await check("a missing plan reports exists=false instead of failing", async () => {
    const read = await readFigurePlan({ artifactPath: path.join(tempRoot, "missing", "none.pptx") });
    assert.equal(read.exists, false);
    assert.equal(read.document, null);
  });

  await check("invalid plan documents are refused before writing", async () => {
    await assert.rejects(
      writeFigurePlan({ artifactPath: path.join(tempRoot, "sibling", "bad.pptx"), document: makePlan({ archetype: "" }) }),
      /archetype/
    );
  });

  // ----------------------------------------------------- discovery
  await check("project discovery stores plans under .scientific-illustrator/figures/", async () => {
    const projectDir = path.join(tempRoot, "proj");
    await fs.mkdir(path.join(projectDir, ".scientific-illustrator"), { recursive: true });
    const artifact = path.join(projectDir, "figures", "fig3.pptx");
    const result = await writeFigurePlan({ artifactPath: artifact, document: makePlan() });
    assert.equal(result.resolution_basis, "project");
    assert.equal(result.resolved_path, path.join(projectDir, ".scientific-illustrator", "figures", "fig3.plan.json"));
  });

  await check("brief-anchored resolution swaps the brief suffix", async () => {
    assert.equal(
      derivePlanPathFromBrief(path.join(tempRoot, "x", "fig.si-brief.json")),
      path.join(tempRoot, "x", "fig.si-plan.json")
    );
    assert.equal(
      derivePlanPathFromBrief(path.join(tempRoot, "x", "fig3.brief.json")),
      path.join(tempRoot, "x", "fig3.plan.json")
    );
    assert.equal(
      derivePlanPathFromBrief(path.join(tempRoot, "x", "custom.json")),
      path.join(tempRoot, "x", "custom.plan.json")
    );
  });

  await check("a brief_path anchors the plan next to the brief", async () => {
    const brief = path.join(tempRoot, "brief-anchor", "fig.si-brief.json");
    const result = await writeFigurePlan({ briefPath: brief, document: makePlan() });
    assert.equal(result.resolution_basis, "brief");
    assert.equal(result.resolved_path, path.join(tempRoot, "brief-anchor", "fig.si-plan.json"));
    const read = await readFigurePlan({ briefPath: brief });
    assert.equal(read.exists, true);
    assert.equal(read.document.figure_kind, "process");
  });

  await check("brief_path wins over artifact_path and is still validated", async () => {
    const artifact = path.join(tempRoot, "priority", "fig.pptx");
    const brief = path.join(tempRoot, "priority", "custom.si-brief.json");
    const result = await resolvePlanTarget({ artifactPath: artifact, briefPath: brief });
    assert.equal(result.resolutionBasis, "brief");
    assert.equal(result.target, path.join(tempRoot, "priority", "custom.si-plan.json"));
    await assert.rejects(resolvePlanTarget({ artifactPath: artifact, briefPath: "relative.json" }), /absolute path/);
    await assert.rejects(resolvePlanTarget({ artifactPath: artifact, briefPath: 42 }), /non-empty absolute path string/);
    await assert.rejects(resolvePlanTarget({ artifactPath: "relative.pptx", briefPath: brief }), /artifact_path must be an absolute path/);
    await assert.rejects(resolvePlanTarget({ artifactPath: 42, briefPath: brief }), /artifact_path must be a non-empty absolute path string/);
  });

  await check("created_at is preserved across updates and updated_at is written", async () => {
    const artifact = path.join(tempRoot, "timestamps", "fig.pptx");
    await writeFigurePlan({ artifactPath: artifact, document: makePlan() });
    const target = path.join(tempRoot, "timestamps", "fig.si-plan.json");
    const stored = JSON.parse(await fs.readFile(target, "utf8"));
    stored.created_at = "2001-02-03T04:05:06.000Z";
    await fs.writeFile(target, JSON.stringify(stored));
    const result = await writeFigurePlan({ artifactPath: artifact, expectedRevision: 0, document: makePlan() });
    assert.equal(result.revision, 1);
    const read = await readFigurePlan({ artifactPath: artifact });
    assert.equal(read.document.created_at, "2001-02-03T04:05:06.000Z");
    assert.equal(typeof read.document.updated_at, "string");
    assert.ok(read.document.updated_at >= read.document.created_at);
  });

  await check("a stored plan without revision reads with a warning", async () => {
    const artifact = path.join(tempRoot, "no-revision", "fig.pptx");
    await writeFigurePlan({ artifactPath: artifact, document: makePlan() });
    const target = path.join(tempRoot, "no-revision", "fig.si-plan.json");
    const stored = JSON.parse(await fs.readFile(target, "utf8"));
    delete stored.revision;
    await fs.writeFile(target, JSON.stringify(stored));
    const read = await readFigurePlan({ artifactPath: artifact });
    assert.equal(read.revision, null);
    assert.equal(read.schema_warnings.some((warning) => warning.includes("revision is missing")), true);
  });

  await check("bad path arguments are rejected instead of coerced", async () => {
    await assert.rejects(resolvePlanTarget({ briefPath: "relative/brief.json" }), /absolute path/);
    await assert.rejects(resolvePlanTarget({ briefPath: 42 }), /non-empty absolute path string/);
    await assert.rejects(resolvePlanTarget({}), /requires artifact_path or brief_path/);
  });

  await check("home-shorthand brief paths expand instead of resolving against cwd", async () => {
    const result = await resolvePlanTarget({ briefPath: "~/p1b-probe/fig.si-brief.json" });
    assert.equal(result.resolutionBasis, "brief");
    assert.equal(result.target, path.join(os.homedir(), "p1b-probe", "fig.si-plan.json"));
  });

  await check("an allowed-root boundary confines brief-anchored plans", async () => {
    const previous = process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT;
    try {
      process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT = tempRoot;
      const inside = await resolvePlanTarget({ briefPath: path.join(tempRoot, "root", "fig.si-brief.json") });
      assert.equal(inside.resolutionBasis, "brief");
      await assert.rejects(
        resolvePlanTarget({ briefPath: path.join(os.tmpdir(), "outside-root", "fig.si-brief.json") }),
        /outside the configured SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT/
      );
    } finally {
      if (previous === undefined) delete process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT;
      else process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT = previous;
    }
  });

  await check("server source wires the plan tools and instructions", async () => {
    const source = await fs.readFile(path.join(root, "plugins", "scientific-illustrator", "scripts", "server.mjs"), "utf8");
    assert.ok(source.includes('name: "figure_plan_read"'));
    assert.ok(source.includes('name: "figure_plan_write"'));
    assert.ok(source.includes("readFigurePlan({ artifactPath: args.artifact_path, briefPath: args.brief_path })"));
    assert.ok(source.includes("figure_plan_read/figure_plan_write persist the design plan"));
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
      await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "figure-plan-smoke", version: "1.0.0" },
      });

      await check("tools/list exposes both plan tools", async () => {
        const tools = await request("tools/list");
        const names = new Set(tools.tools.map((tool) => tool.name));
        assert.ok(names.has("figure_plan_read"), "missing figure_plan_read");
        assert.ok(names.has("figure_plan_write"), "missing figure_plan_write");
      });

      await check("figure_plan_write creates a sibling plan through MCP", async () => {
        const result = await call("figure_plan_write", { artifact_path: artifact, document: makePlan() });
        assert.equal(result.created, true);
        assert.equal(result.revision, 0);
        assert.equal(result.resolved_path, path.join(mcpDir, "deck.si-plan.json"));
      });

      await check("figure_plan_read returns the stored plan through MCP", async () => {
        const result = await call("figure_plan_read", { artifact_path: artifact });
        assert.equal(result.exists, true);
        assert.equal(result.document.figure_kind, "process");
        assert.equal(result.revision, 0);
      });

      await check("figure_plan_read reports a missing plan through MCP", async () => {
        const result = await call("figure_plan_read", { artifact_path: path.join(mcpDir, "other.pptx") });
        assert.equal(result.exists, false);
        assert.equal(result.document, null);
      });

      await check("invalid plans surface as isError through MCP", async () => {
        const result = await request("tools/call", {
          name: "figure_plan_write",
          arguments: { artifact_path: artifact, document: makePlan({ schema: "wrong" }) },
        });
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /schema must be/);
      });
    } finally {
      lines.close();
      child.kill();
    }
  }

  console.log(`\nfigure plan smoke: ${checks} checks passed.`);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

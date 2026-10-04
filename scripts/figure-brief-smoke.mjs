// Figure Truth P0a smoke test for the persistent figure brief support:
// three-level path resolution, minimal schema validation, tool-managed
// revisions with optimistic locking (strict integer), unknown-field warnings,
// allowed-root confinement, the atomic-writer source contract with its
// failure path, and MCP tool wiring.
//
// Run with: node scripts/figure-brief-smoke.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  BRIEF_SCHEMA_VERSION,
  readFigureBrief,
  resolveBriefTarget,
  slugifyFigureId,
  validateBrief,
  writeFigureBrief,
} from "../plugins/scientific-illustrator/scripts/figure-truth.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scientific-illustrator-brief-"));
const OLD_ROOT = process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT;
// Sections 1-3 must run without a configured root; section 4 sets it explicitly.
delete process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT;

let failures = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`  ok - ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL - ${label}: ${error.message}`);
  }
}

function setRoot(root) {
  if (root === null) delete process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT;
  else process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT = root;
}

async function expectThrowsAsync(fn, pattern) {
  let error;
  try {
    await fn();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "expected a throw but none occurred");
  assert.match(String(error.message), pattern);
  return error;
}

function validBrief(overrides = {}) {
  return {
    schema: BRIEF_SCHEMA_VERSION,
    figure_id: "fig3",
    profile: "paper-figure",
    inventory: [
      { id: "t1", kind: "text", text_verbatim: "δ18O" },
      { id: "r1", kind: "raster", atomic: true, reason: "micrograph" },
    ],
    ...overrides,
  };
}

try {
  console.log("1. slugify and schema validation");
  {
    await check("slug strips path-hostile characters", () =>
      assert.equal(slugifyFigureId("Fig 3 / Final?"), "Fig-3-Final"));
    await check("slug falls back for an empty stem", () => assert.equal(slugifyFigureId(""), "figure"));
    await check("valid brief passes without warnings", () => {
      const { errors, warnings } = validateBrief(validBrief());
      assert.deepEqual(errors, []);
      assert.deepEqual(warnings, []);
    });
    await check("missing figure_id is an error", () => {
      const { errors } = validateBrief(validBrief({ figure_id: "" }));
      assert.ok(errors.some((e) => /figure_id/.test(e)));
    });
    await check("duplicate inventory ids are an error", () => {
      const { errors } = validateBrief(validBrief({ inventory: [{ id: "a", kind: "text" }, { id: "a", kind: "line" }] }));
      assert.ok(errors.some((e) => /duplicated/.test(e)));
    });
    await check("unknown field lands in schema warnings, not silence", () => {
      const { errors, warnings } = validateBrief(validBrief({ min_font_size: 7 }));
      assert.deepEqual(errors, []);
      assert.ok(warnings.some((w) => /min_font_size/.test(w)));
    });
    await check("unknown profile warns but stays forward-compatible", () => {
      const { errors, warnings } = validateBrief(validBrief({ profile: "paper_figure" }));
      assert.deepEqual(errors, []);
      assert.ok(warnings.some((w) => /paper_figure/.test(w)));
    });
    await check("bad recreation_policy is an error", () => {
      const { errors } = validateBrief(validBrief({ recreation_policy: "perfect" }));
      assert.ok(errors.some((e) => /recreation_policy/.test(e)));
    });
  }

  console.log("2. three-level resolution");
  {
    const project = path.join(tempRoot, "project");
    const nested = path.join(project, "sub");
    await fs.mkdir(path.join(project, ".scientific-illustrator"), { recursive: true });
    await fs.mkdir(path.join(nested, ".scientific-illustrator"), { recursive: true });
    await fs.mkdir(path.join(nested, "deep"), { recursive: true });

    await check("artifact in a project resolves to figures/<slug>.brief.json", async () => {
      const resolved = await resolveBriefTarget({ artifactPath: path.join(project, "figures", "fig3.pptx") });
      assert.equal(resolved.resolutionBasis, "project");
      assert.equal(resolved.target, path.join(project, ".scientific-illustrator", "figures", "fig3.brief.json"));
    });
    await check("nearest ancestor marker wins", async () => {
      const resolved = await resolveBriefTarget({ artifactPath: path.join(nested, "deep", "fig1.pptx") });
      assert.equal(resolved.resolutionBasis, "project");
      assert.equal(resolved.target, path.join(nested, ".scientific-illustrator", "figures", "fig1.brief.json"));
    });
    await check("no marker above falls back to the sibling brief", async () => {
      const scratch = path.join(tempRoot, "scratch");
      await fs.mkdir(scratch, { recursive: true });
      const resolved = await resolveBriefTarget({ artifactPath: path.join(scratch, "fig9.drawio") });
      assert.equal(resolved.resolutionBasis, "sibling");
      assert.equal(resolved.target, path.join(scratch, "fig9.si-brief.json"));
    });
    await check("explicit brief_path wins over discovery", async () => {
      const explicit = path.join(tempRoot, "custom", "my-brief.json");
      const resolved = await resolveBriefTarget({
        artifactPath: path.join(project, "figures", "fig3.pptx"),
        briefPath: explicit,
      });
      assert.equal(resolved.resolutionBasis, "explicit");
      assert.equal(resolved.target, explicit);
    });
    await check("missing artifact_path and brief_path is rejected", () =>
      expectThrowsAsync(() => resolveBriefTarget({}), /artifact_path or brief_path/));
    await check("non-string and relative path arguments are rejected", async () => {
      await expectThrowsAsync(() => resolveBriefTarget({ artifactPath: 42 }), /must be a non-empty absolute path string/);
      await expectThrowsAsync(() => resolveBriefTarget({ artifactPath: "fig.pptx" }), /must be an absolute path/);
      await expectThrowsAsync(() => resolveBriefTarget({ briefPath: "briefs/fig.json" }), /must be an absolute path/);
    });
  }

  console.log("3. read/write round trip and optimistic locking");
  {
    const dir = path.join(tempRoot, "roundtrip");
    const artifact = path.join(dir, "fig7.pptx");
    const target = path.join(dir, "fig7.si-brief.json");
    await fs.mkdir(dir, { recursive: true });

    await check("read on a missing brief reports exists=false without inventing truth", async () => {
      const result = await readFigureBrief({ artifactPath: artifact });
      assert.equal(result.exists, false);
      assert.equal(result.document, null);
      assert.equal(result.resolved_path, target);
      assert.equal(result.resolution_basis, "sibling");
    });
    await check("creation writes revision 0 with tool-managed timestamps", async () => {
      const result = await writeFigureBrief({ artifactPath: artifact, document: validBrief({ figure_id: "fig7" }) });
      assert.equal(result.created, true);
      assert.equal(result.revision, 0);
      assert.equal(result.resolved_path, target);
      const stored = JSON.parse(await fs.readFile(target, "utf8"));
      assert.equal(stored.revision, 0);
      assert.equal(stored.figure_id, "fig7");
      assert.equal(typeof stored.created_at, "string");
      assert.equal(typeof stored.updated_at, "string");
    });
    await check("read returns the stored document", async () => {
      const result = await readFigureBrief({ artifactPath: artifact });
      assert.equal(result.exists, true);
      assert.equal(result.revision, 0);
      assert.equal(result.document.inventory.length, 2);
      assert.deepEqual(result.schema_warnings, []);
    });
    await check("update requires a matching expected_revision and increments it", async () => {
      const result = await writeFigureBrief({
        artifactPath: artifact,
        document: validBrief({ figure_id: "fig7", intent: { message: "updated" } }),
        expectedRevision: 0,
      });
      assert.equal(result.created, false);
      assert.equal(result.revision, 1);
    });
    await check("stale expected_revision fails loudly", () =>
      expectThrowsAsync(
        () => writeFigureBrief({ artifactPath: artifact, document: validBrief({ figure_id: "fig7" }), expectedRevision: 0 }),
        /does not match the current revision 1/
      ));
    await check("non-integer expected_revision is rejected instead of coerced", async () => {
      for (const bad of [true, "1", 1.5, -1]) {
        await expectThrowsAsync(
          () => writeFigureBrief({ artifactPath: artifact, document: validBrief({ figure_id: "fig7" }), expectedRevision: bad }),
          /non-negative integer/
        );
      }
    });
    await check("omitted expected_revision on an existing brief is rejected", () =>
      expectThrowsAsync(
        () => writeFigureBrief({ artifactPath: artifact, document: validBrief({ figure_id: "fig7" }) }),
        /already exists .*pass expected_revision=1/
      ));
    await check("provided revision is overridden with a warning", async () => {
      const result = await writeFigureBrief({
        artifactPath: artifact,
        document: validBrief({ figure_id: "fig7", revision: 99 }),
        expectedRevision: 1,
      });
      assert.equal(result.revision, 2);
      assert.ok(result.schema_warnings.some((w) => /tool-managed/.test(w)));
    });
    await check("provided created_at is tool-managed and warned", async () => {
      const result = await writeFigureBrief({
        artifactPath: artifact,
        document: validBrief({ figure_id: "fig7", created_at: "1999-01-01T00:00:00.000Z" }),
        expectedRevision: 2,
      });
      assert.equal(result.revision, 3);
      assert.ok(result.schema_warnings.some((w) => /created_at is tool-managed/.test(w)));
      const stored = JSON.parse(await fs.readFile(target, "utf8"));
      assert.notEqual(stored.created_at, "1999-01-01T00:00:00.000Z");
    });
    await check("provided created_at on creation is ignored and warned", async () => {
      const dir = path.join(tempRoot, "created-at-create");
      await fs.mkdir(dir, { recursive: true });
      const freshArtifact = path.join(dir, "fig8.pptx");
      const result = await writeFigureBrief({
        artifactPath: freshArtifact,
        document: validBrief({ figure_id: "fig8", created_at: "1999-01-01T00:00:00.000Z" }),
      });
      assert.equal(result.created, true);
      assert.ok(result.schema_warnings.some((w) => /created_at is tool-managed/.test(w)));
      const stored = JSON.parse(await fs.readFile(path.join(dir, "fig8.si-brief.json"), "utf8"));
      assert.notEqual(stored.created_at, "1999-01-01T00:00:00.000Z");
    });
    await check("creation with a wrong expected_revision is rejected", async () => {
      const fresh = path.join(tempRoot, "fresh");
      await fs.mkdir(fresh, { recursive: true });
      await expectThrowsAsync(
        () => writeFigureBrief({
          artifactPath: path.join(fresh, "fig0.pptx"),
          document: validBrief({ figure_id: "fig0" }),
          expectedRevision: 5,
        }),
        /No brief exists .*expected_revision must be 0/
      );
    });
    await check("unknown fields are preserved on disk and warned", async () => {
      const result = await writeFigureBrief({
        artifactPath: artifact,
        document: validBrief({ figure_id: "fig7", min_font_size: 7 }),
        expectedRevision: 3,
      });
      assert.ok(result.schema_warnings.some((w) => /min_font_size/.test(w)));
      const stored = JSON.parse(await fs.readFile(target, "utf8"));
      assert.equal(stored.min_font_size, 7);
    });
    await check("invalid nested structures are rejected before writing", () =>
      expectThrowsAsync(
        () => writeFigureBrief({ artifactPath: artifact, document: validBrief({ figure_id: "fig7", claims: "not-an-array" }), expectedRevision: 4 }),
        /claims must be an array/
      ));
    await check("broken JSON on disk is reported instead of clobbered", async () => {
      const broken = path.join(dir, "broken.si-brief.json");
      await fs.writeFile(broken, "{not json", "utf8");
      await expectThrowsAsync(
        () => writeFigureBrief({ briefPath: broken, document: validBrief({ figure_id: "broken" }) }),
        /not valid JSON/
      );
      assert.equal(await fs.readFile(broken, "utf8"), "{not json");
    });
    await check("non-object JSON on disk is refused, not overwritten", async () => {
      const nullFile = path.join(dir, "null.si-brief.json");
      await fs.writeFile(nullFile, "null", "utf8");
      await expectThrowsAsync(
        () => writeFigureBrief({ briefPath: nullFile, document: validBrief({ figure_id: "nullfig" }) }),
        /not a JSON object/
      );
      assert.equal(await fs.readFile(nullFile, "utf8"), "null");
    });
    await check("existing invalid revision is refused, not silently reset", async () => {
      const badRev = path.join(dir, "badrev.si-brief.json");
      await fs.writeFile(
        badRev,
        JSON.stringify({ schema: BRIEF_SCHEMA_VERSION, figure_id: "badrev", revision: "3" }),
        "utf8"
      );
      await expectThrowsAsync(
        () => writeFigureBrief({ briefPath: badRev, document: validBrief({ figure_id: "badrev" }), expectedRevision: 0 }),
        /invalid or missing revision/
      );
    });
    await check("very long stems are truncated with a hash suffix and still round-trip", async () => {
      const longDir = path.join(tempRoot, "longstem");
      await fs.mkdir(longDir, { recursive: true });
      const artifact = path.join(longDir, `${"x".repeat(300)}.pptx`);
      const result = await writeFigureBrief({ artifactPath: artifact, document: validBrief({ figure_id: "longfig" }) });
      assert.ok(path.basename(result.resolved_path).length < 120, `slug too long: ${path.basename(result.resolved_path)}`);
      const readBack = await readFigureBrief({ artifactPath: artifact });
      assert.equal(readBack.exists, true);
      assert.equal(readBack.document.figure_id, "longfig");
    });
  }

  console.log("4. allowed-root confinement");
  {
    const allowed = path.join(tempRoot, "allowed");
    const outside = path.join(tempRoot, "outside-artifact");
    await fs.mkdir(allowed, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    setRoot(allowed);

    await check("artifact inside the root resolves normally", async () => {
      const resolved = await resolveBriefTarget({ artifactPath: path.join(allowed, "fig2.pptx") });
      assert.equal(resolved.resolutionBasis, "sibling");
    });
    await check("artifact outside the root is rejected", () =>
      expectThrowsAsync(
        () => resolveBriefTarget({ artifactPath: path.join(outside, "fig2.pptx") }),
        /outside the configured/
      ));
    await check("explicit brief_path outside the root is rejected", () =>
      expectThrowsAsync(
        () => resolveBriefTarget({ briefPath: path.join(outside, "brief.json") }),
        /outside the configured/
      ));
    await check("discovery never probes above the allowed root", async () => {
      const boundary = path.join(tempRoot, "boundary");
      const rootDir = path.join(boundary, "root");
      await fs.mkdir(path.join(boundary, ".scientific-illustrator"), { recursive: true });
      await fs.mkdir(rootDir, { recursive: true });
      const artifact = path.join(rootDir, "figX.pptx");
      setRoot(rootDir);
      const confined = await resolveBriefTarget({ artifactPath: artifact });
      assert.equal(confined.resolutionBasis, "sibling");
      setRoot(null);
      const unconfined = await resolveBriefTarget({ artifactPath: artifact });
      assert.equal(unconfined.resolutionBasis, "project");
      assert.equal(unconfined.target, path.join(boundary, ".scientific-illustrator", "figures", "figX.brief.json"));
    });
    setRoot(null);
  }

  console.log("5. MCP tool wiring");
  {
    const mcpDir = path.join(tempRoot, "mcp");
    await fs.mkdir(mcpDir, { recursive: true });
    const artifact = path.join(mcpDir, "fig1.pptx");
    const child = spawn(process.execPath, [path.join(repoRoot, "plugins", "scientific-illustrator", "scripts", "server.mjs")], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: child.stdout });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });

    const responses = new Map();
    const completed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP brief test timed out.\n${stderr}`)), 10000);
      lines.on("line", (line) => {
        try {
          const message = JSON.parse(line);
          if ([1, 2, 3, 4, 5].includes(message.id)) responses.set(message.id, message);
          if (responses.size === 5) {
            clearTimeout(timer);
            resolve();
          }
        } catch (error) {
          clearTimeout(timer);
          reject(new Error(`Invalid MCP JSON: ${error.message}`));
        }
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (responses.size < 5) reject(new Error(`server.mjs exited early with ${code}. ${stderr}`));
      });
    });

    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "figure-brief-smoke", version: "1.0.0" } } })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "figure_brief_write", arguments: { artifact_path: artifact, document: validBrief({ figure_id: "fig1" }) } } })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "figure_brief_read", arguments: { artifact_path: artifact } } })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "figure_brief_write", arguments: { artifact_path: path.join(mcpDir, "fig-bad.pptx"), document: { schema: BRIEF_SCHEMA_VERSION, profile: "paper-figure", inventory: [] } } } })}\n`);

    try {
      await completed;
      await check("tools/list exposes both brief tools", () => {
        const tools = responses.get(2)?.result?.tools || [];
        const names = new Set(tools.map((tool) => tool.name));
        assert.ok(names.has("figure_brief_read"));
        assert.ok(names.has("figure_brief_write"));
      });
      await check("figure_brief_write creates a sibling brief through MCP", () => {
        const result = responses.get(3)?.result;
        assert.ok(!result?.isError, JSON.stringify(result));
        assert.equal(result.structuredContent.created, true);
        assert.equal(result.structuredContent.revision, 0);
        assert.equal(result.structuredContent.resolved_path, path.join(mcpDir, "fig1.si-brief.json"));
      });
      await check("figure_brief_read returns the stored document through MCP", () => {
        const result = responses.get(4)?.result;
        assert.ok(!result?.isError, JSON.stringify(result));
        assert.equal(result.structuredContent.document.figure_id, "fig1");
        assert.equal(result.structuredContent.exists, true);
      });
      await check("invalid document surfaces as an isError tool result", () => {
        const result = responses.get(5)?.result;
        assert.equal(result?.isError, true);
        assert.match(result.content[0].text, /figure_id/);
      });
    } finally {
      lines.close();
      child.kill();
    }
  }

  console.log("6. atomic-writer source contract and failure path");
  {
    await check("brief writes go through the shared guardrails atomicWrite helper", async () => {
      const source = await fs.readFile(
        path.join(repoRoot, "plugins", "scientific-illustrator", "scripts", "figure-truth.mjs"),
        "utf8"
      );
      assert.match(source, /import\s*\{[^}]*\batomicWrite\b[^}]*\}\s*from\s*"\.\/guardrails\.mjs"/);
      assert.match(source, /await atomicWrite\(/);
    });
    if (process.platform === "win32") {
      await check("a failed update leaves the original brief intact and removes temp files", async () => {
        const dir = path.join(tempRoot, "readonly");
        await fs.mkdir(dir, { recursive: true });
        const artifact = path.join(dir, "figro.pptx");
        await writeFigureBrief({ artifactPath: artifact, document: validBrief({ figure_id: "figro" }) });
        const briefPath = path.join(dir, "figro.si-brief.json");
        const before = await fs.readFile(briefPath, "utf8");
        await fs.chmod(briefPath, 0o444);
        try {
          await expectThrowsAsync(
            () => writeFigureBrief({ artifactPath: artifact, document: validBrief({ figure_id: "figro" }), expectedRevision: 0 }),
            /EPERM|EACCES/
          );
          assert.equal(await fs.readFile(briefPath, "utf8"), before);
          const leftovers = (await fs.readdir(dir)).filter((name) => name.includes(".tmp"));
          assert.deepEqual(leftovers, []);
        } finally {
          await fs.chmod(briefPath, 0o666).catch(() => {});
        }
      });
    } else {
      console.log("  (read-only rename failure path is Windows-specific; skipped on this platform)");
    }
  }
} finally {
  if (OLD_ROOT === undefined) delete process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT;
  else process.env.SCIENTIFIC_ILLUSTRATOR_ALLOWED_ROOT = OLD_ROOT;
  await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
}

if (failures > 0) {
  console.error(`\nfigure-brief-smoke: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nfigure-brief-smoke: all brief persistence checks passed.");
process.exit(0);

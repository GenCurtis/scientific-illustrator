// Publication compliance smoke test: publisher spec loading/validation,
// layered rule resolution with provenance, freshness, unknowns, and the MCP
// wiring of figure_rules_resolve / publisher_spec_get / publisher_spec_resolve.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { promises as fs } from "node:fs";
import os from "node:os";

import {
  KNOWN_PUBLISHERS,
  PUBLISHER_SPEC_SCHEMA_VERSION,
  evaluateFreshness,
  getPublisherSpecDocument,
  loadPublisherSpecs,
  resolveFigureRules,
  resolvePublisherSpecs,
  validatePublisherSpec,
} from "../plugins/scientific-illustrator/scripts/publication-compliance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
let checks = 0;

async function check(name, fn) {
  checks += 1;
  try {
    await fn();
    console.log(`ok ${checks} - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`not ok ${checks} - ${name}: ${error.message}`);
  }
}

function baseSpec(overrides = {}) {
  return {
    schema: PUBLISHER_SPEC_SCHEMA_VERSION,
    id: "example-baseline",
    publisher: "Example",
    source: {
      authority: "official",
      checked_at: "2026-10-04",
      retrieved_by: "manual-audit",
      source_urls: ["https://example.com/guidelines"],
    },
    scope: { profile: ["paper-figure"] },
    rules: { raster: { halftone: { minimum_dpi: 300, comparison: "greater-than-or-equal" } } },
    confidence: { level: "publisher-baseline" },
    refresh: { strategy: "manual-review", stale_after_days: 365 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Module: loading and validation
// ---------------------------------------------------------------------------

await check("KNOWN_PUBLISHERS is the curated first batch", () => {
  assert.deepEqual(KNOWN_PUBLISHERS, ["acm", "elsevier", "ieee", "springer-nature"]);
});

for (const publisher of KNOWN_PUBLISHERS) {
  await check(`loadPublisherSpecs(${publisher}) loads baseline first with a README`, () => {
    const loaded = loadPublisherSpecs(publisher);
    assert.equal(loaded.publisher, publisher);
    assert.ok(loaded.specs.length >= 1);
    assert.equal(loaded.specs[0].file, "baseline.json");
    assert.ok(loaded.specs[0].spec.id.startsWith(`${publisher}-`));
    assert.equal(typeof loaded.readme, "string");
    assert.ok(loaded.readme.length > 0);
  });
}

await check("loadPublisherSpecs rejects unknown publishers with the known list", () => {
  assert.throws(() => loadPublisherSpecs("nobody"), /not one of the known publishers/);
});

await check("validatePublisherSpec accepts a well-formed spec", () => {
  const { errors, warnings } = validatePublisherSpec(baseSpec(), { slug: "example", file: "baseline.json" });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

await check("validatePublisherSpec rejects wrong schema, comparison, date, scope, and refresh", () => {
  const bad = baseSpec({
    schema: "scientific-illustrator/publisher-spec@2",
    scope: { profile: ["unknown-profile"] },
    refresh: { strategy: "manual-review", stale_after_days: 0 },
  });
  bad.rules.raster.halftone.comparison = "more-than";
  bad.source.checked_at = "2026-13-40";
  const { errors } = validatePublisherSpec(bad, { slug: "example", file: "baseline.json" });
  assert.ok(errors.some((message) => message.includes("schema must be")));
  assert.ok(errors.some((message) => message.includes("comparison must be one of")));
  assert.ok(errors.some((message) => message.includes("checked_at")));
  assert.ok(errors.some((message) => message.includes("unknown profile")));
  assert.ok(errors.some((message) => message.includes("stale_after_days")));
});

await check("validatePublisherSpec warns on unknown fields and empty source_urls", () => {
  const spec = baseSpec({ future_field: true });
  spec.source.source_urls = [];
  const { errors, warnings } = validatePublisherSpec(spec, { slug: "example", file: "baseline.json" });
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((message) => message.includes("future_field")));
  assert.ok(warnings.some((message) => message.includes("source_urls is empty")));
});

await check("validatePublisherSpec hardens reserved keys, unknown booleans, and calendar dates", () => {
  const hardened = baseSpec();
  hardened.source.checked_at = "2026-02-30";
  hardened.rules.raster.halftone.unknown = "yes";
  hardened.rules.constructor = { minimum_dpi: 300 };
  const { errors } = validatePublisherSpec(hardened, { slug: "example", file: "baseline.json" });
  assert.ok(errors.some((message) => message.includes("calendar date")));
  assert.ok(errors.some((message) => message.includes(".unknown must be a boolean")));
  assert.ok(errors.some((message) => message.includes("reserved object key")));
  const dotted = baseSpec();
  dotted.rules["a.b"] = { minimum_dpi: 300 };
  const { errors: dotErrors, warnings } = validatePublisherSpec(dotted, { slug: "example", file: "baseline.json" });
  assert.deepEqual(dotErrors, []);
  assert.ok(warnings.some((message) => message.includes("literal dot")));
});

await check("publisher validation messages survive the shared-spec refactor", () => {
  const bad = baseSpec();
  bad.schema = "scientific-illustrator/publisher-spec@2";
  delete bad.publisher;
  const { errors } = validatePublisherSpec(bad, { slug: "example", file: "baseline.json" });
  assert.ok(errors.includes('schema must be "scientific-illustrator/publisher-spec@1".'));
  assert.ok(errors.includes("publisher must be a non-empty string."));
  const prefixed = validatePublisherSpec(baseSpec({ id: "other-baseline" }), { slug: "example", file: "baseline.json" });
  assert.ok(prefixed.warnings.includes('id "other-baseline" does not start with the publisher slug "example-".'));
  const unknown = validatePublisherSpec(baseSpec({ mystery: 1 }), { slug: "example", file: "baseline.json" });
  assert.ok(unknown.warnings.includes('unknown field "mystery" is preserved but not part of publisher-spec@1.'));
  const noAuthority = baseSpec();
  delete noAuthority.source.authority;
  const missingAuthority = validatePublisherSpec(noAuthority, { slug: "example", file: "baseline.json" });
  assert.ok(missingAuthority.errors.includes("source.authority must be a non-empty string."));
});

await check("loadPublisherSpecs rejects duplicate spec ids in one publisher directory", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "sci-illu-pubdup-"));
  try {
    const pluginDir = path.join(temp, "plugins", "scientific-illustrator");
    const scriptsDir = path.join(pluginDir, "scripts");
    await fs.mkdir(scriptsDir, { recursive: true });
    for (const file of ["publication-compliance.mjs", "figure-truth.mjs", "guardrails.mjs"]) {
      await fs.copyFile(path.join(root, "plugins/scientific-illustrator/scripts", file), path.join(scriptsDir, file));
    }
    await fs.cp(path.join(root, "plugins/scientific-illustrator/references"), path.join(pluginDir, "references"), { recursive: true });
    await fs.copyFile(path.join(root, "package.json"), path.join(temp, "package.json"));
    const duplicate = JSON.parse(await fs.readFile(path.join(pluginDir, "references/publishers/ieee/baseline.json"), "utf8"));
    await fs.writeFile(path.join(pluginDir, "references/publishers/ieee/dup.json"), JSON.stringify(duplicate, null, 2));
    const probePath = path.join(temp, "probe.mjs");
    const moduleUrl = pathToFileURL(path.join(scriptsDir, "publication-compliance.mjs")).href;
    await fs.writeFile(
      probePath,
      `import { loadPublisherSpecs } from ${JSON.stringify(moduleUrl)};\n` +
        `try { loadPublisherSpecs("ieee"); console.log("NO_THROW"); process.exit(1); } ` +
        `catch (error) { console.log(/duplicate spec id/.test(error.message) ? "THREW" : "WRONG:" + error.message); }\n`,
    );
    const probe = spawnSync(process.execPath, [probePath], { encoding: "utf8" });
    assert.equal(probe.status, 0, probe.stdout + probe.stderr);
    assert.match(probe.stdout, /THREW/);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Module: layered resolution
// ---------------------------------------------------------------------------

await check("figure_rules_resolve merges profile defaults with the publisher baseline", () => {
  const result = resolveFigureRules({ profile: "paper-figure", publisher: "elsevier" });
  assert.deepEqual(result.layers.map((layer) => layer.kind), ["profile-defaults", "publisher-spec"]);
  assert.equal(result.layers[1].id, "elsevier-baseline");
  assert.equal(result.resolved["min_font_pt"].value, 7);
  assert.equal(result.resolved["min_font_pt"].source, "profile-defaults:paper-figure");
  const lineArt = result.resolved["raster.line_art.minimum_dpi"];
  assert.equal(lineArt.value, 1000);
  assert.equal(lineArt.source, "publisher:elsevier-baseline");
  assert.equal(lineArt.source_version, "2026-10-04");
  assert.equal(lineArt.overridden, false);
  assert.equal(result.resolved["raster.halftone.comparison"].value, "greater-than-or-equal");
  assert.ok(result.resolved["fonts.recommended"].value.includes("Arial"));
  assert.deepEqual(result.overrides, []);
  assert.deepEqual(result.unknowns, []);
  assert.ok(result.runtime_statement.includes("Applied Elsevier publisher baseline (checked 2026-10-04)."));
  assert.ok(result.runtime_statement.includes("Journal-specific author instructions may override these values."));
  assert.ok(result.runtime_statement.includes("No venue-specific override is installed."));
});

await check("IEEE strict comparisons are preserved, never flattened to inclusive", () => {
  const result = resolveFigureRules({ profile: "paper-figure", publisher: "ieee" });
  assert.equal(result.resolved["raster.color_grayscale.comparison"].value, "greater-than");
  assert.equal(result.resolved["raster.color_grayscale.minimum_dpi"].value, 300);
  assert.equal(result.resolved["raster.bw_line_art.comparison"].value, "greater-than");
  assert.equal(result.resolved["raster.bw_line_art.minimum_dpi"].value, 600);
});

await check("IEEE graphical-abstract merges baseline plus the profile-specific spec", () => {
  const result = resolveFigureRules({ profile: "graphical-abstract", publisher: "ieee" });
  assert.deepEqual(result.layers.map((layer) => layer.id), ["graphical-abstract", "ieee-baseline", "ieee-graphical-abstract"]);
  assert.deepEqual(result.resolved["canvas_px"].value, [660, 295]);
  assert.equal(result.resolved["raster.minimum_dpi"].value, 300);
  assert.equal(result.resolved["raster.comparison"].value, "greater-than-or-equal");
  assert.equal(result.resolved["fonts.minimum_text_px"].value, 16);
  assert.ok(result.runtime_statement.includes("Additional publisher specs applied: ieee-graphical-abstract."));
});

await check("ACM keeps an explicitly unknown raster DPI instead of inventing one", () => {
  const result = resolveFigureRules({ profile: "paper-figure", publisher: "acm" });
  assert.equal(result.resolved["raster.dpi.unknown"].value, true);
  assert.equal(result.resolved["raster.dpi.unknown"].source, "publisher:acm-baseline");
  assert.equal(result.unknowns.length, 1);
  assert.equal(result.unknowns[0].token, "raster.dpi");
  assert.ok(result.unknowns[0].note.includes("venue-specific"));
  assert.ok(result.resolved["accessibility.latex_target"].value.includes("\\Description"));
});

await check("user overrides win and are logged with the previous source", () => {
  const result = resolveFigureRules({
    profile: "paper-figure",
    publisher: "elsevier",
    overrides: { "raster.line_art.minimum_dpi": 800 },
  });
  assert.equal(result.resolved["raster.line_art.minimum_dpi"].value, 800);
  assert.equal(result.resolved["raster.line_art.minimum_dpi"].source, "user-override");
  assert.equal(result.resolved["raster.line_art.minimum_dpi"].overridden, true);
  assert.equal(result.resolved["raster.line_art.minimum_dpi"].overridden_from, "publisher:elsevier-baseline");
  assert.equal(result.overrides.length, 1);
  assert.equal(result.overrides[0].token, "raster.line_art.minimum_dpi");
  assert.equal(result.overrides[0].previous.source, "publisher:elsevier-baseline");
  assert.equal(result.layers.at(-1).kind, "user-override");
});

await check("an unknown venue is reported, never silently ignored", () => {
  const result = resolveFigureRules({ profile: "paper-figure", publisher: "ieee", venue: "example-journal" });
  assert.ok(result.warnings.some((message) => message.includes('venue "example-journal" has no installed adapter')));
  assert.ok(result.unknowns.some((entry) => entry.token === "venue"));
  assert.ok(result.runtime_statement.includes('No venue-specific override is installed for "example-journal"'));
});

await check("a publisher without a spec for the requested profile degrades with a warning", () => {
  const result = resolveFigureRules({ profile: "poster", publisher: "elsevier" });
  assert.equal(result.layers.filter((layer) => layer.kind === "publisher-spec").length, 0);
  assert.ok(result.warnings.some((message) => message.includes('has no installed spec for profile "poster"')));
  assert.ok(result.runtime_statement.includes('No installed publisher spec applies to this profile for "elsevier".'));
});

await check("without a publisher only profile defaults apply", () => {
  const result = resolveFigureRules({ profile: "paper-figure" });
  assert.deepEqual(result.layers.map((layer) => layer.kind), ["profile-defaults"]);
  assert.ok(result.runtime_statement.startsWith("No publisher baseline applied; generic profile defaults only."));
});

await check("resolveFigureRules validates profile, publisher, and overrides", () => {
  assert.throws(() => resolveFigureRules({ profile: "nope" }), /not one of the known profiles/);
  assert.throws(() => resolveFigureRules({ profile: "paper-figure", publisher: "nobody" }), /not one of the known publishers/);
  assert.throws(() => resolveFigureRules({ profile: "paper-figure", publisher: 42 }), /publisher must be a non-empty string/);
  assert.throws(() => resolveFigureRules({ profile: "paper-figure", overrides: [] }), /overrides must be a plain object/);
  assert.throws(() => resolveFigureRules({ profile: "paper-figure", overrides: { "__proto__.x": 1 } }), /reserved object key/);
  const poisoned = JSON.parse('{"__proto__": {"polluted": true}}');
  assert.throws(() => resolveFigureRules({ profile: "paper-figure", overrides: poisoned }), /reserved object key/);
  assert.equal({}.polluted, undefined);
  assert.throws(() => resolveFigureRules({ profile: "paper-figure", overrides: { "raster..line": 1 } }), /empty path segment/);
  assert.throws(() => resolveFigureRules({ profile: "paper-figure", venue: 42 }), /venue must be a non-empty string/);
  assert.throws(() => resolveFigureRules({ profile: "paper-figure", figureKind: 42 }), /figure_kind must be a non-empty string/);
  assert.throws(() => resolveFigureRules({ profile: "paper-figure", styleId: 42 }), /style_id must be a non-empty string/);
  assert.throws(() => resolvePublisherSpecs({ publisher: "ieee", profile: "typo" }), /not one of the known profiles/);
  assert.throws(() => resolvePublisherSpecs({ publisher: "ieee", profile: 42 }), /profile must be a non-empty string/);
  assert.throws(() => getPublisherSpecDocument({ publisher: "ieee", specId: 42 }), /spec_id must be a non-empty string/);
  const protoToken = resolveFigureRules({ profile: "paper-figure", overrides: { toString: 5 } });
  assert.equal(protoToken.resolved["toString"].value, 5);
  assert.equal(protoToken.resolved["toString"].overridden, false);
  assert.deepEqual(protoToken.overrides, []);
});

await check("evaluateFreshness flags specs beyond their maintenance window", () => {
  const { specs } = loadPublisherSpecs("elsevier");
  const fresh = evaluateFreshness(specs[0].spec, new Date("2026-10-04T00:00:00Z"));
  assert.equal(fresh.stale, false);
  assert.equal(fresh.age_days, 0);
  const boundaryFresh = evaluateFreshness(specs[0].spec, new Date("2027-10-04T00:00:00Z"));
  assert.equal(boundaryFresh.age_days, 365);
  assert.equal(boundaryFresh.stale, false);
  const boundaryStale = evaluateFreshness(specs[0].spec, new Date("2027-10-05T00:00:00Z"));
  assert.equal(boundaryStale.age_days, 366);
  assert.equal(boundaryStale.stale, true);
  const stale = evaluateFreshness(specs[0].spec, new Date("2027-11-15T00:00:00Z"));
  assert.equal(stale.stale, true);
  assert.ok(stale.age_days > 365);
  assert.ok(stale.message.includes("maintenance window"));
});

await check("a stale spec surfaces as a resolver warning and runtime statement line", () => {
  const { specs } = loadPublisherSpecs("elsevier");
  const result = resolveFigureRules({
    profile: "paper-figure",
    publisher: "elsevier",
    now: new Date("2027-11-15T00:00:00Z"),
  });
  assert.equal(result.freshness[0].stale, true);
  assert.ok(result.warnings.some((message) => message.includes("maintenance window")));
  assert.ok(result.runtime_statement.includes("maintenance window"));
  assert.equal(specs[0].spec.id, "elsevier-baseline");
});

await check("resolvePublisherSpecs filters by profile and merges when omitted", () => {
  const all = resolvePublisherSpecs({ publisher: "ieee" });
  assert.deepEqual(all.layers.map((layer) => layer.id), ["ieee-baseline", "ieee-graphical-abstract"]);
  const paper = resolvePublisherSpecs({ publisher: "ieee", profile: "paper-figure" });
  assert.deepEqual(paper.layers.map((layer) => layer.id), ["ieee-baseline"]);
  const poster = resolvePublisherSpecs({ publisher: "ieee", profile: "poster" });
  assert.equal(poster.layers.length, 0);
  assert.ok(poster.warnings.some((message) => message.includes("no installed spec")));
});

await check("getPublisherSpecDocument returns raw specs and the README, with spec_id filtering", () => {
  const doc = getPublisherSpecDocument({ publisher: "ieee" });
  assert.equal(doc.specs.length, 2);
  assert.ok(doc.readme.includes("IEEE"));
  const single = getPublisherSpecDocument({ publisher: "ieee", specId: "ieee-graphical-abstract" });
  assert.equal(single.specs.length, 1);
  assert.equal(single.specs[0].spec.id, "ieee-graphical-abstract");
  assert.throws(() => getPublisherSpecDocument({ publisher: "ieee", specId: "ieee-nope" }), /no spec with id/);
});

// ---------------------------------------------------------------------------
// MCP end-to-end
// ---------------------------------------------------------------------------

const serverPath = path.join(root, "plugins/scientific-illustrator/scripts/server.mjs");
const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
const pending = new Map();
let nextId = 1;
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const resolver = pending.get(message.id);
  if (resolver) {
    pending.delete(message.id);
    resolver(message);
  }
});

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout waiting for ${method}`));
    }, 8000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message.result);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

async function call(name, args) {
  const result = await request("tools/call", { name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content).slice(0, 300)}`);
  return result.structuredContent;
}

try {
  const list = await request("tools/list", {});
  const names = list.tools.map((tool) => tool.name);

  await check("MCP tools/list exposes exactly 22 tools including the compliance, venue, and alt-text tools", () => {
    assert.equal(list.tools.length, 22);
    for (const name of ["figure_rules_resolve", "publisher_spec_get", "publisher_spec_resolve", "venue_spec_get", "figure_alt_text_generate"]) {
      assert.ok(names.includes(name), `${name} must be listed`);
    }
  });

  await check("MCP figure_rules_resolve resolves elsevier with provenance", async () => {
    const value = await call("figure_rules_resolve", { profile: "paper-figure", publisher: "elsevier" });
    assert.equal(value.resolved["raster.line_art.minimum_dpi"].value, 1000);
    assert.equal(value.resolved["raster.line_art.minimum_dpi"].source, "publisher:elsevier-baseline");
    assert.ok(value.runtime_statement.includes("Elsevier"));
    assert.deepEqual(value.unknowns, []);
  });

  await check("MCP publisher_spec_get returns the raw adapter and README", async () => {
    const value = await call("publisher_spec_get", { publisher: "acm" });
    assert.equal(value.specs.length, 1);
    assert.equal(value.specs[0].id, "acm-baseline");
    assert.ok(value.readme.includes("ACM"));
  });

  await check("MCP publisher_spec_resolve merges the IEEE profile-specific spec", async () => {
    const value = await call("publisher_spec_resolve", { publisher: "ieee" });
    assert.deepEqual(value.layers.map((layer) => layer.id), ["ieee-baseline", "ieee-graphical-abstract"]);
  });

  await check("MCP figure_rules_resolve passes overrides, venue, and context through", async () => {
    const value = await call("figure_rules_resolve", {
      profile: "paper-figure",
      publisher: "elsevier",
      venue: "example-journal",
      figure_kind: "mechanism",
      style_id: "main",
      overrides: { "raster.line_art.minimum_dpi": 800 },
    });
    assert.equal(value.resolved["raster.line_art.minimum_dpi"].value, 800);
    assert.ok(value.warnings.some((message) => message.includes("example-journal")));
    assert.equal(value.context.figure_kind, "mechanism");
    assert.equal(value.context.style_id, "main");
    assert.equal(value.context.venue, "example-journal");
  });

  await check("MCP publisher_spec_resolve honors the profile filter", async () => {
    const value = await call("publisher_spec_resolve", { publisher: "ieee", profile: "paper-figure" });
    assert.deepEqual(value.layers.map((layer) => layer.id), ["ieee-baseline"]);
  });

  await check("MCP compliance tool schemas keep required fields and closed objects", () => {
    for (const name of ["figure_rules_resolve", "publisher_spec_get", "publisher_spec_resolve"]) {
      const tool = list.tools.find((entry) => entry.name === name);
      assert.equal(tool.inputSchema.additionalProperties, false, `${name} must be closed`);
    }
    assert.deepEqual(list.tools.find((entry) => entry.name === "figure_rules_resolve").inputSchema.required, ["profile"]);
    assert.deepEqual(list.tools.find((entry) => entry.name === "publisher_spec_get").inputSchema.required, ["publisher"]);
    assert.deepEqual(list.tools.find((entry) => entry.name === "publisher_spec_resolve").inputSchema.required, ["publisher"]);
  });

  await check("MCP compliance tools fail loud on unknown publishers", async () => {
    const result = await request("tools/call", { name: "figure_rules_resolve", arguments: { profile: "paper-figure", publisher: "nobody" } });
    assert.equal(result.isError, true);
    assert.ok(JSON.stringify(result.content).includes("known publishers"));
  });
} finally {
  lines.close();
  child.kill();
}

if (failures.length > 0) {
  console.error(`publication compliance smoke: ${failures.length} of ${checks} checks failed.`);
  for (const { name, error } of failures) console.error(`  - ${name}: ${error.stack || error.message}`);
  process.exit(1);
}
console.log(`publication compliance smoke: ${checks} checks passed.`);

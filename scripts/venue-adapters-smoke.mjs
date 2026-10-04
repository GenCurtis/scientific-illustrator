// Verifies the P4 venue-adapter layer: venue spec loading and validation,
// resolution order (venue spec applies after the publisher layer and before
// user overrides), runtime statements, unknown-venue behavior, the raw venue
// document tool, and the MCP surface through a real server process.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KNOWN_VENUES,
  VENUE_SPEC_SCHEMA_VERSION,
  getVenueSpecDocument,
  loadVenueSpecs,
  resolveFigureRules,
  validateVenueSpec,
} from "../plugins/scientific-illustrator/scripts/publication-compliance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok - ${name}`);
}

try {
  // ----------------------------------------------------- constants and loader
  await check("the venue adapter list and schema version are stable", async () => {
    assert.deepEqual(KNOWN_VENUES, ["egu-ga"]);
    assert.equal(VENUE_SPEC_SCHEMA_VERSION, "scientific-illustrator/venue-spec@1");
  });

  await check("egu-ga loads baseline, poster specs, and the README", async () => {
    const loaded = loadVenueSpecs("egu-ga");
    assert.equal(loaded.venue, "egu-ga");
    assert.deepEqual(
      loaded.specs.map(({ file, spec }) => [file, spec.id]),
      [
        ["baseline.json", "egu-ga-baseline"],
        ["poster.json", "egu-ga-poster"],
      ]
    );
    assert.match(loaded.readme, /1978/);
    assert.match(loaded.readme, /16 ?pt/);
  });

  await check("unknown and empty venue slugs are refused by the loader", async () => {
    assert.throws(() => loadVenueSpecs("agu-fm"), /not one of the known venues/);
    assert.throws(() => loadVenueSpecs(""), /non-empty string/);
    assert.throws(() => loadVenueSpecs(7), /non-empty string/);
  });

  // ----------------------------------------------------- spec validation
  const baselineSpec = loadVenueSpecs("egu-ga").specs[0].spec;

  await check("a bundled venue spec validates cleanly", async () => {
    const { errors, warnings } = validateVenueSpec(baselineSpec, { slug: "egu-ga", file: "baseline.json" });
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  await check("the venue schema version is enforced", async () => {
    const { errors } = validateVenueSpec({ ...baselineSpec, schema: "scientific-illustrator/venue-spec@2" });
    assert.equal(errors.some((error) => error.includes("venue-spec@1")), true);
  });

  await check("the venue identity field is required", async () => {
    const { venue, ...withoutVenue } = baselineSpec;
    const { errors } = validateVenueSpec(withoutVenue);
    assert.equal(errors.some((error) => error.includes("venue must be a non-empty string")), true);
  });

  await check("id prefixes are checked against the venue slug", async () => {
    const { warnings } = validateVenueSpec({ ...baselineSpec, id: "egu-baseline" }, { slug: "egu-ga" });
    assert.equal(warnings.some((warning) => warning.includes("venue slug")), true);
  });

  await check("reserved rule keys are rejected in venue specs", async () => {
    const spec = { ...baselineSpec, rules: JSON.parse('{"__proto__": 1}') };
    const { errors } = validateVenueSpec(spec);
    assert.equal(errors.some((error) => error.includes("reserved object key")), true);
  });

  await check("unknown venue fields are preserved but warned", async () => {
    const { warnings } = validateVenueSpec({ ...baselineSpec, mystery: 1 });
    assert.equal(warnings.some((warning) => warning.includes("venue-spec@1")), true);
  });

  // ----------------------------------------------------- resolution
  await check("the egu-ga adapter resolves poster rules with provenance", async () => {
    const result = resolveFigureRules({ profile: "poster", venue: "egu-ga" });
    assert.deepEqual(result.resolved.canvas_mm.value, [1978, 1183]);
    assert.equal(result.resolved.canvas_mm.source, "venue:egu-ga-poster");
    assert.equal(result.resolved.canvas_mm.overridden, false);
    assert.equal(result.resolved.orientation.value, "landscape");
    assert.equal(result.resolved.orientation.overridden_from, "profile-defaults:poster");
    assert.equal(result.resolved.min_font_pt.value, 16);
    assert.equal(result.resolved.min_font_pt.source, "venue:egu-ga-baseline");
    assert.equal(result.resolved["accessibility.non_color_encoding"].value, true);
    assert.equal(result.unknowns.some((unknown) => unknown.token === "venue"), false);
    assert.match(result.runtime_statement, /Applied egu-ga venue adapter \(checked 2026-10-04\)\./);
  });

  await check("venue layers apply after the publisher layer", async () => {
    const result = resolveFigureRules({ profile: "poster", publisher: "elsevier", venue: "egu-ga" });
    const kinds = result.layers.map((layer) => layer.kind);
    assert.deepEqual(kinds, ["profile-defaults", "venue-spec", "venue-spec"]);
    const ids = result.layers.filter((layer) => layer.kind === "venue-spec").map((layer) => layer.id);
    assert.deepEqual(ids, ["egu-ga-baseline", "egu-ga-poster"]);
  });

  await check("venue rules win over a publisher spec that targets the same profile", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "sci-illu-venueorder-"));
    try {
      const pluginDir = path.join(temp, "plugins", "scientific-illustrator");
      const scriptsDir = path.join(pluginDir, "scripts");
      await fs.mkdir(scriptsDir, { recursive: true });
      for (const file of ["publication-compliance.mjs", "figure-truth.mjs", "guardrails.mjs"]) {
        await fs.copyFile(path.join(root, "plugins", "scientific-illustrator", "scripts", file), path.join(scriptsDir, file));
      }
      await fs.cp(path.join(root, "plugins", "scientific-illustrator", "references"), path.join(pluginDir, "references"), { recursive: true });
      await fs.writeFile(path.join(temp, "package.json"), JSON.stringify({ version: "sandbox" }));
      await fs.writeFile(
        path.join(pluginDir, "references", "publishers", "elsevier", "poster-sandbox.json"),
        JSON.stringify({
          schema: "scientific-illustrator/publisher-spec@1",
          id: "elsevier-poster",
          publisher: "elsevier",
          source: { authority: "sandbox", checked_at: "2026-10-04", retrieved_by: "smoke", source_urls: ["https://example.invalid"] },
          scope: { profile: ["poster"] },
          rules: { min_font_pt: 99 },
          confidence: { level: "sandbox" },
          refresh: { strategy: "manual", stale_after_days: 365 },
        })
      );
      const probe = path.join(temp, "probe.mjs");
      await fs.writeFile(
        probe,
        [
          'import { resolveFigureRules } from "./plugins/scientific-illustrator/scripts/publication-compliance.mjs";',
          'const result = resolveFigureRules({ profile: "poster", publisher: "elsevier", venue: "egu-ga" });',
          "console.log(JSON.stringify({ kinds: result.layers.map((layer) => layer.kind), min: result.resolved.min_font_pt.value, source: result.resolved.min_font_pt.source }));",
        ].join("\n")
      );
      const run = spawnSync(process.execPath, [probe], { encoding: "utf8", timeout: 30000 });
      assert.equal(run.status, 0, run.stderr);
      const parsed = JSON.parse(run.stdout.trim());
      assert.deepEqual(parsed.kinds, ["profile-defaults", "publisher-spec", "venue-spec", "venue-spec"]);
      assert.equal(parsed.min, 16);
      assert.equal(parsed.source, "venue:egu-ga-baseline");
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  });

  await check("user overrides still win over venue rules", async () => {
    const result = resolveFigureRules({ profile: "poster", venue: "egu-ga", overrides: { min_font_pt: 28 } });
    assert.equal(result.resolved.min_font_pt.value, 28);
    assert.equal(result.resolved.min_font_pt.source, "user-override");
    assert.equal(result.resolved.min_font_pt.overridden_from, "venue:egu-ga-baseline");
  });

  await check("a venue without a spec for the profile warns instead of guessing", async () => {
    const result = resolveFigureRules({ profile: "diagram", venue: "egu-ga" });
    assert.equal(result.layers.some((layer) => layer.kind === "venue-spec"), false);
    assert.equal(result.warnings.some((warning) => warning.includes('no installed spec for profile "diagram"')), true);
    assert.match(result.runtime_statement, /A egu-ga venue adapter is installed, but it has no spec for this profile; the publisher baseline applies\./);
  });

  await check("unknown venues keep the publisher baseline and report the gap", async () => {
    const result = resolveFigureRules({ profile: "poster", venue: "agu-fm" });
    assert.deepEqual(result.unknowns, [
      { token: "venue", note: 'no installed venue adapter for "agu-fm"; the publisher baseline applies instead' },
    ]);
    assert.equal(result.warnings.some((warning) => warning.includes("no installed adapter")), true);
    assert.match(result.runtime_statement, /No venue-specific override is installed for "agu-fm"; the publisher baseline applies\./);
  });

  await check("venue freshness is reported for stale adapters", async () => {
    const result = resolveFigureRules({ profile: "poster", venue: "egu-ga", now: new Date("2027-11-15T00:00:00Z") });
    assert.deepEqual(
      result.freshness.map((entry) => entry.spec_id),
      ["egu-ga-baseline", "egu-ga-poster"]
    );
    assert.equal(result.freshness.every((entry) => entry.stale === true), true);
    assert.equal(result.warnings.some((warning) => warning.includes("maintenance window")), true);
    assert.match(result.runtime_statement, /maintenance window/);
  });

  await check("without a venue the runtime statement stays unchanged", async () => {
    const result = resolveFigureRules({ profile: "poster" });
    assert.match(result.runtime_statement, /No venue-specific override is installed\./);
    assert.equal(result.unknowns.some((unknown) => unknown.token === "venue"), false);
  });

  // ----------------------------------------------------- raw document tool
  await check("getVenueSpecDocument returns the raw adapter documents", async () => {
    const document = getVenueSpecDocument({ venue: "egu-ga" });
    assert.equal(document.venue, "egu-ga");
    assert.equal(document.specs.length, 2);
    assert.match(document.readme, /Poster presenter guidelines/);
    const single = getVenueSpecDocument({ venue: "egu-ga", specId: "egu-ga-poster" });
    assert.equal(single.specs.length, 1);
    assert.equal(single.specs[0].spec.rules.orientation, "landscape");
    assert.throws(() => getVenueSpecDocument({ venue: "egu-ga", specId: "nope" }), /no spec with id "nope"/);
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
      const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "venue-adapters-smoke", version: "1.0.0" } });

      await check("tools/list exposes venue_spec_get and mentions installed venues", async () => {
        const tools = await request("tools/list");
        const names = new Set(tools.tools.map((tool) => tool.name));
        assert.equal(names.has("venue_spec_get"), true);
        assert.equal(names.has("figure_alt_text_generate"), true);
        const resolver = tools.tools.find((tool) => tool.name === "figure_rules_resolve");
        assert.match(resolver.inputSchema.properties.venue.description, /egu-ga/);
        assert.equal(typeof init.instructions, "string");
        assert.match(init.instructions, /venue_spec_get/);
        assert.match(init.instructions, /egu-ga/);
      });

      await check("venue_spec_get returns the raw adapter through MCP", async () => {
        const value = await call("venue_spec_get", { venue: "egu-ga" });
        assert.equal(value.venue, "egu-ga");
        assert.equal(value.specs.length, 2);
        assert.match(value.readme, /1978/);
        const single = await call("venue_spec_get", { venue: "egu-ga", spec_id: "egu-ga-baseline" });
        assert.equal(single.specs.length, 1);
        assert.equal(single.specs[0].spec.rules.min_font_pt, 16);
      });

      await check("unknown venues are refused with an actionable error", async () => {
        await assert.rejects(call("venue_spec_get", { venue: "agu-fm" }), /not one of the known venues/);
      });
    } finally {
      lines.close();
      child.kill();
    }
  }
} finally {
  // nothing to clean up: this smoke never writes to disk
}

console.log(`venue adapters smoke: ${checks} checks passed.`);

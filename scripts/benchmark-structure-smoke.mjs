// Verifies the P1d design benchmark structure: the shared 10-dimension rubric,
// the curated fixture inventory (schema markers, known figure_kind and profile,
// non-empty expectations and failure modes), and that every embedded truth
// passes validateBrief without warnings. The behavioral (LLM-backed) part of
// the benchmark is intentionally opt-in and documented in
// references/benchmark/README.md; this smoke keeps only the CI-safe structural
// contract.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KNOWN_FIGURE_KINDS,
  KNOWN_PROFILES,
  validateBrief,
} from "../plugins/scientific-illustrator/scripts/figure-truth.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkDirectory = path.join(root, "plugins", "scientific-illustrator", "references", "benchmark");
const fixturesDirectory = path.join(benchmarkDirectory, "fixtures");
const RUBRIC_SCHEMA = "scientific-illustrator/benchmark-rubric@1";
const FIXTURE_SCHEMA = "scientific-illustrator/benchmark-fixture@1";
const RUBRIC_DIMENSIONS = [
  "scientific-correctness",
  "scientific-clarity",
  "visual-hierarchy",
  "composition",
  "information-density",
  "readability",
  "semantic-consistency",
  "accessibility",
  "publication-compliance",
  "professional-polish",
];
const FIXTURE_IDS = [
  "workflow-linear",
  "workflow-branched",
  "mechanism-biological",
  "process-cyclic",
  "comparison-before-after",
  "comparison-control-treatment",
  "multi-panel-data",
  "image-panel-microscopy",
  "network",
  "graphical-abstract",
  "poster-module",
  "slide-figure",
];

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok - ${name}`);
}

try {
  // ------------------------------------------------------------- rubric
  const rubric = JSON.parse(await fs.readFile(path.join(benchmarkDirectory, "rubric.json"), "utf8"));

  await check("the rubric declares the shared schema and exactly ten dimensions", async () => {
    assert.equal(rubric.schema, RUBRIC_SCHEMA);
    assert.ok(Array.isArray(rubric.dimensions), "rubric.dimensions must be an array");
    assert.deepEqual(
      rubric.dimensions.map((dimension) => dimension.id),
      RUBRIC_DIMENSIONS,
      "rubric dimension ids must match the curated list exactly",
    );
  });

  await check("every rubric dimension carries a name and a scoring question", async () => {
    for (const dimension of rubric.dimensions) {
      assert.equal(
        typeof dimension.name === "string" && dimension.name.trim().length > 0,
        true,
        `${dimension.id} needs a non-empty name`,
      );
      assert.equal(
        typeof dimension.question === "string" && dimension.question.trim().length > 0,
        true,
        `${dimension.id} needs a non-empty scoring question`,
      );
    }
  });

  // ------------------------------------------------------------ fixtures
  await check("the fixtures directory matches the curated inventory exactly", async () => {
    const files = (await fs.readdir(fixturesDirectory)).filter((name) => name.endsWith(".json"));
    assert.deepEqual([...files].sort(), [...FIXTURE_IDS.map((id) => `${id}.json`)].sort());
  });

  const fixtures = new Map();
  for (const id of FIXTURE_IDS) {
    fixtures.set(id, JSON.parse(await fs.readFile(path.join(fixturesDirectory, `${id}.json`), "utf8")));
  }

  await check("every fixture declares the fixture schema and its own id", async () => {
    for (const [id, fixture] of fixtures) {
      assert.equal(fixture.schema, FIXTURE_SCHEMA, `${id} schema drifted`);
      assert.equal(fixture.id, id, `${id} id must match its file name`);
      assert.equal(
        typeof fixture.title === "string" && fixture.title.trim().length > 0,
        true,
        `${id} needs a non-empty title`,
      );
    }
  });

  await check("every fixture uses a known figure_kind and profile", async () => {
    for (const [id, fixture] of fixtures) {
      assert.ok(
        KNOWN_FIGURE_KINDS.includes(fixture.figure_kind),
        `${id} has unknown figure_kind "${fixture.figure_kind}"`,
      );
      assert.ok(
        KNOWN_PROFILES.includes(fixture.profile),
        `${id} has unknown profile "${fixture.profile}"`,
      );
    }
  });

  await check("every fixture lists expected characteristics and known failure modes", async () => {
    for (const [id, fixture] of fixtures) {
      for (const [field, minimum] of [["expected_design_characteristics", 3], ["known_failure_modes", 2]]) {
        const values = fixture[field];
        assert.ok(
          Array.isArray(values) && values.length >= minimum,
          `${id} needs at least ${minimum} ${field} entries`,
        );
        for (const value of values) {
          assert.equal(
            typeof value === "string" && value.trim().length > 0,
            true,
            `${id} ${field} entries must be non-empty strings`,
          );
        }
      }
    }
  });

  await check("every fixture references the shared rubric and an optional reference output", async () => {
    for (const [id, fixture] of fixtures) {
      assert.equal(fixture.rubric, RUBRIC_SCHEMA, `${id} must reference the shared rubric`);
      assert.ok(
        fixture.reference_output === null || typeof fixture.reference_output === "string",
        `${id} reference_output must be null or a path string`,
      );
    }
  });

  await check("every embedded truth passes validateBrief without warnings", async () => {
    for (const [id, fixture] of fixtures) {
      const { errors, warnings } = validateBrief(fixture.truth);
      assert.deepEqual(errors, [], `${id} truth failed validation: ${errors.join("; ")}`);
      assert.deepEqual(warnings, [], `${id} truth produced warnings: ${warnings.join("; ")}`);
    }
  });

  await check("every truth agrees with its fixture axes and carries inventory", async () => {
    for (const [id, fixture] of fixtures) {
      assert.equal(fixture.truth.figure_kind, fixture.figure_kind, `${id} truth figure_kind differs from the fixture`);
      assert.equal(fixture.truth.profile, fixture.profile, `${id} truth profile differs from the fixture`);
      assert.equal(
        typeof fixture.truth.figure_id === "string" && fixture.truth.figure_id.trim().length > 0,
        true,
        `${id} truth needs a figure_id`,
      );
      assert.ok(
        Array.isArray(fixture.truth.inventory) && fixture.truth.inventory.length > 0,
        `${id} truth needs inventory`,
      );
    }
  });

  // -------------------------------------------------------------- readme
  await check("the benchmark README documents the CI-safe and opt-in split", async () => {
    const readme = await fs.readFile(path.join(benchmarkDirectory, "README.md"), "utf8");
    assert.ok(/opt-in/i.test(readme), "README must document the opt-in behavioral runs");
    assert.ok(/paired review/i.test(readme), "README must document the old vs new paired review");
    assert.ok(readme.includes("rubric.json"), "README must reference the rubric file");
    assert.ok(readme.includes("fixtures"), "README must reference the fixtures directory");
  });

  console.log(`benchmark structure smoke: ${checks} checks passed.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

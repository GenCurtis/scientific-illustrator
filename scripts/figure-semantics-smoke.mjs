// Verifies the P0d brief semantics: figure_kind taxonomy, claims/relations/
// quantities item schemas, inventory cross-references, source-ambiguity
// grading, acceptance.block_on_structural_ambiguity, profile_settings typo
// warnings, and the recreation gate (faithful reports; publication-ready
// blocks unresolved semantic ambiguity). The gate is also exercised through
// the real write/read path so the tool output contract stays locked.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRIEF_SCHEMA_VERSION,
  evaluateRecreationGate,
  readFigureBrief,
  validateBrief,
  writeFigureBrief,
} from "../plugins/scientific-illustrator/scripts/figure-truth.mjs";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sci-illu-semantics-"));
let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`ok - ${name}`);
}

function makeBrief(overrides = {}) {
  return {
    schema: BRIEF_SCHEMA_VERSION,
    figure_id: "semantic-figure",
    profile: "paper-figure",
    inventory: [
      { id: "panel-a", kind: "panel" },
      { id: "panel-b", kind: "panel" },
    ],
    ...overrides,
  };
}

function errorsOf(document) {
  return validateBrief(document).errors;
}
function warningsOf(document) {
  return validateBrief(document).warnings;
}

try {
  // ----------------------------------------------------- semantic schema
  await check("a fully specified semantic brief passes without warnings", async () => {
    const document = makeBrief({
      figure_kind: "mechanism",
      claims: [
        { id: "c1", statement: "Treatment increases X relative to control", priority: 1, supported_by: ["panel-b"], status: "asserted" },
      ],
      relations: [{ id: "rel1", source: "panel-a", target: "panel-b", relation: "inhibits" }],
      quantities: [{ id: "q1", quantity: "concentration", unit: "mg/L" }],
      source_ambiguities: [{ item: "panel-b", severity: "semantic", question: "dose unreadable at source resolution" }],
      recreation_policy: "publication-ready",
      acceptance: { block_on_structural_ambiguity: true },
    });
    assert.deepEqual(errorsOf(document), []);
    assert.deepEqual(warningsOf(document), []);
  });

  await check("an unknown figure_kind warns but does not fail", async () => {
    const document = makeBrief({ figure_kind: "mechansim" });
    assert.deepEqual(errorsOf(document), []);
    assert.equal(warningsOf(document).some((warning) => warning.includes("figure_kind")), true);
  });

  await check("an empty figure_kind fails", async () => {
    assert.equal(errorsOf(makeBrief({ figure_kind: "  " })).some((error) => error.includes("figure_kind")), true);
  });

  await check("claims require id and statement", async () => {
    const errors = errorsOf(makeBrief({ claims: [{ priority: 1 }] }));
    assert.equal(errors.some((error) => error.includes("claims[0].id")), true);
    assert.equal(errors.some((error) => error.includes("claims[0].statement")), true);
  });

  await check("duplicate claim ids fail", async () => {
    const errors = errorsOf(
      makeBrief({
        claims: [
          { id: "c1", statement: "A" },
          { id: "c1", statement: "B" },
        ],
      })
    );
    assert.equal(errors.some((error) => error.includes('claims[1].id "c1" is duplicated')), true);
  });

  await check("claim priority must be a positive integer", async () => {
    assert.equal(errorsOf(makeBrief({ claims: [{ id: "c1", statement: "A", priority: 0 }] })).some((error) => error.includes("priority")), true);
    assert.equal(errorsOf(makeBrief({ claims: [{ id: "c1", statement: "A", priority: 1.5 }] })).some((error) => error.includes("priority")), true);
  });

  await check("dangling supported_by references fail", async () => {
    const errors = errorsOf(makeBrief({ claims: [{ id: "c1", statement: "A", supported_by: ["panel-z"] }] }));
    assert.equal(errors.some((error) => error.includes('unknown inventory id "panel-z"')), true);
  });

  await check("supported_by must be an array of ids", async () => {
    const errors = errorsOf(makeBrief({ claims: [{ id: "c1", statement: "A", supported_by: "panel-a" }] }));
    assert.equal(errors.some((error) => error.includes("supported_by must be an array")), true);
  });

  await check("claim status must be a non-empty string", async () => {
    assert.equal(errorsOf(makeBrief({ claims: [{ id: "c1", statement: "A", status: 5 }] })).some((error) => error.includes("status")), true);
  });

  await check("relations require resolvable endpoints and a relation", async () => {
    const errors = errorsOf(makeBrief({ relations: [{ id: "rel1", source: "panel-z", target: "panel-b" }] }));
    assert.equal(errors.some((error) => error.includes('relations[0].source references unknown inventory id "panel-z"')), true);
    assert.equal(errors.some((error) => error.includes("relations[0].relation")), true);
  });

  await check("duplicate relation ids fail", async () => {
    const errors = errorsOf(
      makeBrief({
        relations: [
          { id: "rel1", source: "panel-a", target: "panel-b", relation: "inhibits" },
          { id: "rel1", source: "panel-b", target: "panel-a", relation: "activates" },
        ],
      })
    );
    assert.equal(errors.some((error) => error.includes('relations[1].id "rel1" is duplicated')), true);
  });

  await check("quantities require quantity and unit", async () => {
    const errors = errorsOf(makeBrief({ quantities: [{ id: "q1", quantity: "concentration" }] }));
    assert.equal(errors.some((error) => error.includes("quantities[0].unit")), true);
  });

  await check("ambiguity severity must be graded", async () => {
    const errors = errorsOf(makeBrief({ source_ambiguities: [{ severity: "major", question: "?" }] }));
    assert.equal(errors.some((error) => error.includes("severity must be one of cosmetic, structural, semantic")), true);
  });

  await check("ambiguity items outside the inventory warn", async () => {
    const document = makeBrief({ source_ambiguities: [{ item: "tiny-caption", severity: "cosmetic", question: "?" }] });
    assert.deepEqual(errorsOf(document), []);
    assert.equal(warningsOf(document).some((warning) => warning.includes("tiny-caption")), true);
  });

  await check("ambiguity resolution must be a string or null", async () => {
    assert.equal(errorsOf(makeBrief({ source_ambiguities: [{ severity: "cosmetic", question: "?", resolution: 5 }] })).some((error) => error.includes("resolution")), true);
    assert.deepEqual(errorsOf(makeBrief({ source_ambiguities: [{ severity: "cosmetic", question: "?", resolution: null }] })), []);
  });

  await check("acceptance.block_on_structural_ambiguity must be boolean", async () => {
    const errors = errorsOf(makeBrief({ acceptance: { block_on_structural_ambiguity: "yes" } }));
    assert.equal(errors.some((error) => error.includes("block_on_structural_ambiguity")), true);
  });

  await check("unknown profile_settings keys warn with the known parameter list", async () => {
    const warnings = warningsOf(makeBrief({ profile_settings: { min_font_size: 6, min_font_pt: 7 } }));
    assert.equal(warnings.some((warning) => warning.startsWith("profile_settings.min_font_size")), true);
    assert.equal(warnings.some((warning) => warning.startsWith("profile_settings.min_font_pt ")), false);
  });

  await check("known profile_settings keys do not warn", async () => {
    const warnings = warningsOf(
      makeBrief({ profile_settings: { journal: "example-journal", column_class: "double", min_font_pt: 7 } })
    );
    assert.deepEqual(warnings, []);
  });

  // ----------------------------------------------------- recreation gate
  await check("faithful reports semantic ambiguity without blocking", async () => {
    const gate = evaluateRecreationGate(
      makeBrief({
        recreation_policy: "faithful",
        source_ambiguities: [{ item: "panel-b", severity: "semantic", question: "dose unclear" }],
      })
    );
    assert.equal(gate.policy, "faithful");
    assert.deepEqual(gate.blocking, []);
    assert.equal(gate.advisory.length, 1);
  });

  await check("publication-ready blocks unresolved semantic ambiguity", async () => {
    const gate = evaluateRecreationGate(
      makeBrief({
        recreation_policy: "publication-ready",
        source_ambiguities: [{ item: "panel-b", severity: "semantic", question: "dose unclear" }],
      })
    );
    assert.equal(gate.blocking.length, 1);
    assert.equal(gate.blocking[0].question, "dose unclear");
  });

  await check("structural ambiguity blocks only when configured", async () => {
    const ambiguity = { item: "panel-b", severity: "structural", question: "layout unclear" };
    const withoutFlag = evaluateRecreationGate(makeBrief({ recreation_policy: "publication-ready", source_ambiguities: [ambiguity] }));
    assert.deepEqual(withoutFlag.blocking, []);
    const withFlag = evaluateRecreationGate(
      makeBrief({ recreation_policy: "publication-ready", acceptance: { block_on_structural_ambiguity: true }, source_ambiguities: [ambiguity] })
    );
    assert.equal(withFlag.blocking.length, 1);
  });

  await check("cosmetic ambiguity never blocks", async () => {
    const gate = evaluateRecreationGate(
      makeBrief({
        recreation_policy: "publication-ready",
        acceptance: { block_on_structural_ambiguity: true },
        source_ambiguities: [{ item: "panel-b", severity: "cosmetic", question: "font looks odd" }],
      })
    );
    assert.deepEqual(gate.blocking, []);
    assert.equal(gate.advisory.length, 1);
  });

  await check("resolved ambiguity leaves the blocking set", async () => {
    const gate = evaluateRecreationGate(
      makeBrief({
        recreation_policy: "publication-ready",
        source_ambiguities: [{ item: "panel-b", severity: "semantic", question: "dose unclear", resolution: "confirmed 5 mg/L" }],
      })
    );
    assert.deepEqual(gate.blocking, []);
    assert.equal(gate.resolved.length, 1);
    assert.equal(gate.resolved[0].question, "dose unclear");
  });

  await check("an unspecified policy never blocks", async () => {
    const gate = evaluateRecreationGate(makeBrief({ source_ambiguities: [{ severity: "semantic", question: "?" }] }));
    assert.equal(gate.policy, "unspecified");
    assert.deepEqual(gate.blocking, []);
  });

  // ----------------------------------------------------- write/read contract
  await check("write returns the recreation gate for the stored document", async () => {
    const artifact = path.join(tempRoot, "gate", "fig.pptx");
    const result = await writeFigureBrief({
      artifactPath: artifact,
      document: makeBrief({
        recreation_policy: "publication-ready",
        source_ambiguities: [{ item: "panel-b", severity: "semantic", question: "control identity unclear" }],
      }),
    });
    assert.equal(result.recreation_gate.policy, "publication-ready");
    assert.equal(result.recreation_gate.blocking.length, 1);
    assert.equal(result.schema_warnings.length, 0);
  });

  await check("read returns the recreation gate and survives a plain brief", async () => {
    const artifact = path.join(tempRoot, "gate", "fig.pptx");
    const read = await readFigureBrief({ artifactPath: artifact });
    assert.equal(read.exists, true);
    assert.equal(read.recreation_gate.blocking[0].question, "control identity unclear");
    const plain = await writeFigureBrief({
      artifactPath: path.join(tempRoot, "gate", "plain.pptx"),
      document: makeBrief(),
    });
    assert.equal(plain.recreation_gate.policy, "unspecified");
    assert.deepEqual(plain.recreation_gate.blocking, []);
    assert.deepEqual(plain.recreation_gate.advisory, []);
  });

  await check("a missing brief still reports an empty recreation gate", async () => {
    const read = await readFigureBrief({ artifactPath: path.join(tempRoot, "missing-brief.pptx") });
    assert.equal(read.exists, false);
    assert.equal(read.recreation_gate.policy, "unspecified");
    assert.deepEqual(read.recreation_gate.blocking, []);
    assert.deepEqual(read.recreation_gate.advisory, []);
  });

  console.log(`\nfigure semantics smoke: ${checks} checks passed.`);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

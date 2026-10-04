# Figure design benchmark

Curated fixtures for measuring figure design quality across the Scientific
Illustrator workflow. The benchmark exists so that design-intelligence changes
(grammar pages, profiles, style system, skills) can be evaluated against fixed
truths instead of ad-hoc examples.

## Layout

- `rubric.json` — the shared 10-dimension review rubric
  (`scientific-illustrator/benchmark-rubric@1`). Every fixture references it.
- `fixtures/<id>.json` — one fixture per scenario. Each fixture carries:
  - `truth`: a brief prototype that must pass `validateBrief` (P0a schema);
  - `figure_kind` / `profile`: the orthogonal axes under test;
  - `expected_design_characteristics`: structural and encoding choices a good
    design should exhibit;
  - `known_failure_modes`: the defects the review must catch;
  - `reference_output`: an optional path to a curated output (null until one
    is recorded);
  - `rubric`: the rubric id used for scoring.

## CI-safe checks

`node scripts/benchmark-structure-smoke.mjs` validates the structure: rubric
dimensions, fixture inventory, schema markers, kind and profile validity, and
`validateBrief` on every embedded truth. It runs in the regular test chain and
performs no model calls.

## Behavioral runs (opt-in)

A behavioral run drives the real Designer, Drawer, Reviewer, and Corrector
workflow for a fixture's truth, then scores the result against the rubric.
These runs require a model and a rendering backend, so they stay opt-in:

1. pick a fixture and feed its `truth` through the design workflow;
2. score the output on all 10 rubric dimensions (0 to 1 per dimension);
3. record the scores, the failure modes actually observed, and the run
   metadata (model, backend, date) next to the fixture;
4. keep runs reproducible: same fixture, same rubric, fresh output.

## Version upgrades

When changing design intelligence (grammar, profiles, style, skills), compare
**old vs new in paired review**: render the same fixture with the previous and
the new revision, score both against the rubric, and only accept the change
when the new revision wins on the dimensions it targets without regressing
others. A higher audit score alone is not evidence of a better figure.

## Adding fixtures

Add one JSON file per scenario, follow the existing schema, embed a truth that
passes `validateBrief` without warnings, and list at least three expected
characteristics and two known failure modes.

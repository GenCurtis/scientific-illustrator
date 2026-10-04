---
name: recreate-scientific-figure
description: Recreate a supplied scientific figure, graphical abstract, workflow, model diagram, or multi-panel schematic as a maximally editable illustration in visible draw.io, Microsoft PowerPoint, or WPS Presentation. Use when a PNG/JPEG/SVG/PDF reference must be rebuilt panel by panel through a Designer, Drawer, Reviewer, and Corrector loop with backend capability detection, atomic raster decomposition, local checks, and repeated whole-figure verification.
compatibility: opencode, claude, codex, factory
---

# Recreate Scientific Figure

Coordinate one backend-neutral four-role protocol. Keep the roles logically separate even when one agent performs all four. Let the user choose draw.io, Microsoft PowerPoint, or WPS Presentation; the choice changes the implementation, never the quality contract.

In OpenCode, load this skill with the `skill` tool: `skill({ name: "recreate-scientific-figure" })`.

Use `$recreate-scientific-figure-in-drawio` as the draw.io Drawer adapter and `$edit-powerpoint-live` as the PowerPoint/WPS Drawer adapter. Use `$audit-scientific-figure` as the Reviewer and `$correct-scientific-figure` as the Corrector.

## Apply the recreation policy

Read the brief with `figure_brief_read` before drawing. Its `recreation_policy` and `recreation_gate` control how strictly design rules apply:

- `faithful`: maximize visual fidelity. Style and profile rules are largely advisory, unresolved semantic ambiguity is reported but does not block, and the reference is never beautified.
- `publication-ready`: preserve scientific meaning and the main visual language while fixing accessibility, publication, typography, spacing, and export defects. Resolve publisher and venue constraints with `figure_rules_resolve` before fixing publication or export defects; the runtime statement names the applied baseline. Never change scientific truth without explicit user confirmation; unresolved semantic ambiguity blocks.

When the brief records a `figure_kind`, load `figure_kind_get` and use its grammar to understand the reference structure before assigning regions. Both policies stay under the precedence chain: scientific truth, integrity, and explicit user decisions outrank venue constraints, reference fidelity, manuscript style, and profile defaults.

## Preserve backend parity

Require both backends to deliver the same semantic capabilities:

- editable text, shapes, symbols, panels, lines, arrows, and attached connectors;
- editable tables and regular charts: native in COM/OOXML PowerPoint, editable shape composites in Office.js PowerPoint or draw.io when their live APIs cannot insert a native chart;
- stable object names/ids, duplication, grouping, z-order, exact alignment, and equal distribution;
- one picture object per irreducible raster field, with all reconstructable overlays rebuilt separately;
- visible object-by-object construction in draw.io, PowerPoint COM, and connected PowerPoint Office.js; explicitly labeled, checkpointed, and verification-aware file refresh in OOXML fallback mode;
- structure audit plus renderer audit after every region and after the whole figure;
- an editable source file and requested exports.

Do not relax a rule because one backend represents the object differently.

## Designer handoff

Treat the supplied reference as the design authority. Extract its design; do not redesign it for convenience.

1. Inspect the full-resolution reference and readable local details.
2. Record the reference size, aspect ratio, reading direction, panel bounds, coordinate transform, palette, typography, and z-order.
3. Assign every region a stable id, bounding box, title, construction order, incoming links, and outgoing links.
4. Inventory every visible item as editable text, editable shape, free line, attached connector, editable table/chart, repeated motif, or irreducible raster field.
5. Decompose grids, prediction comparisons, image stacks, mask rows, and multi-image panels into individual raster fields plus editable titles, frames, grids, legends, arrows, axes, and annotations.
6. Record unreadable text and obscured boundaries as explicit ambiguities. Never invent content.

Produce a `reconstruction_spec` before drawing. It must contain region ids, object ids, geometry, styles, connector routes, grouping, raster decomposition decisions, and local acceptance conditions.

## Drawer handoff

1. Detect the selected backend's current capabilities before choosing objects. For live Mac PowerPoint, require a connected `officejs-context-sync` task pane and lock it with `powerpoint_set_backend` before drawing; otherwise report the OOXML fallback instead of promising a live animation.
2. Connect or create an isolated editable document and inspect its structure. For WPS, require explicit target-application fields and never treat a managed file, helper process, or dispatched open request as proof that the deck is open.
3. Establish canvas/slide size, panel skeleton, alignment anchors, spacing tokens, and connector lanes.
4. Execute the spec in dependency order with stable semantic names and zero artificial delay; use the backend sequence tool with bounded batches (see `edit-powerpoint-live` or `recreate-scientific-figure-in-drawio` for that backend's pacing modes).
5. Return a `draw_log` containing created/updated object ids, object classes, grouping, and every raster declaration.

Never insert a whole panel merely because cropping is faster or visually convenient.

## Reviewer handoff

After each checkpoint, require both evidence channels:

- structure evidence from `powerpoint_audit_figure` or `drawio_live_audit_figure` plus inspection;
- renderer evidence from a PowerPoint slide export or draw.io screenshot, compared with the matching reference crop.

The Reviewer must report every defect with:

- region and object names/ids;
- category and severity;
- concrete evidence;
- required correction;
- measurable acceptance condition.

Review semantics, text, editability, raster atomicity, geometry, spacing, typography, clipping, z-order, arrow direction, endpoint clearance, path-through-object, connector crossings, and reference correspondence.

## Corrector handoff

Give Reviewer findings to `$correct-scientific-figure`. Require an ordered object-level `correction_plan`; then return it to the same backend Drawer. Correct the smallest responsible objects. Do not flatten, screenshot, or replace a larger region to hide a defect.

## Checkpoint loop

At each meaningful checkpoint (a bounded batch that completes a coherent module, before replicating a new motif, and after routing, grouping, or z-order changes), repeat:

1. Drawer constructs or updates named editable objects in bounded zero-delay batches.
2. Drawer renders the affected whole slide/canvas context once.
3. Reviewer inspects structure and render; Corrector emits exact operations only for defective objects and their dependencies.
4. Drawer executes them and rerenders the affected content.

Unchanged, already accepted modules do not need another local review; they are still included in the final whole-figure check. Do not proceed past a checkpoint while a changed module has an unresolved hard failure except a documented source ambiguity.

## Whole-figure review

After the checkpoints pass, repeat the same review for the complete figure. Check cross-region alignment, scale, hierarchy, whitespace, palette, font metrics, routing lanes, global balance, object hierarchy, and reference similarity.

Finish only when:

- readable semantic/text accuracy is 1.00;
- editability coverage of reconstructable content is 1.00;
- clipping and unintended-overlap safety is 1.00;
- layout/alignment confidence is at least 0.95;
- connector clarity confidence is at least 0.95;
- reference correspondence confidence is at least 0.90;
- deterministic audit reports zero hard failures;
- no warning remains unless it is an unavoidable, explicitly reported source ambiguity.

Confidence must be justified by current renderer and structure evidence, not successful tool calls.

## Raster gate

Require every retained image to declare:

- `raster_reason`;
- `source_is_tightly_cropped` or explicit crop values;
- `atomic_raster_unit=true`;
- `contains_reconstructable_content=false`;
- `decomposition_note`.

Reject any image that still contains separable fields, text, frames, arrows, legends, axes, tables, regular plots, or other reconstructable drawing grammar.

## Delivery

Save the editable `.drawio` or `.pptx` and requested previews. Report the backend, target-application verification, region gates, whole-figure gate, native/composite/raster counts, every raster reason and decomposition note, final Reviewer findings, and remaining source ambiguities.

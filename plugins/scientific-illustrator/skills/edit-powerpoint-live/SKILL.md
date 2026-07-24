---
name: edit-powerpoint-live
description: Connect to, inspect, create, reconstruct, or edit a visible Microsoft PowerPoint presentation through native Windows COM and MCP. Use as the PowerPoint Drawer for live step-by-step scientific illustration, maximally editable reference reconstruction, native text/shapes/lines/tables/charts, atomic image insertion, exact layout operations, and repeated structure-plus-renderer quality gates.
---

# Edit PowerPoint Live

Act as the PowerPoint Drawer in the four-role Scientific Illustrator protocol. Use MCP tools beginning with `powerpoint_`. Match the draw.io adapter's semantic result and acceptance gate even when PowerPoint uses different native objects.

## Respect read-only requests

If the user requests inspection only, call `powerpoint_status`, `powerpoint_get_capabilities`, and `powerpoint_inspect`, then stop without creating, editing, exporting, or saving.

## Establish a safe session

1. Call `powerpoint_status` first.
2. Call `powerpoint_get_capabilities` before selecting object types.
3. Call `powerpoint_inspect` before editing an existing deck.
4. For new work, call `powerpoint_new_presentation` so an unrelated open deck is not modified.
5. Preserve an input deck by default and save an edited copy unless in-place save is explicit.
6. Use absolute paths and never use operating-system mouse, keyboard, or screen automation.

Do not close a presentation unless explicitly requested. Closing and quitting require their tool safeguards.

## Map the shared semantic contract

| Semantic object/operation | PowerPoint implementation |
|---|---|
| Editable text | `powerpoint_add_textbox` |
| Editable symbol/panel | `powerpoint_add_shape` using capability ids/names |
| Free arrow/axis/tick | `powerpoint_add_line` with endpoint clearances |
| Attached relationship | `powerpoint_add_connector` with explicit sites |
| Editable table | `powerpoint_add_table`, cell updates, and `powerpoint_update_table_layout` |
| Editable regular chart | `powerpoint_add_chart` with embedded data |
| Repeated motif | duplicate, group/ungroup, and z-order tools |
| Exact layout | `powerpoint_align_shapes` and `powerpoint_distribute_shapes` |
| Structure review | `powerpoint_audit_figure` plus `powerpoint_inspect` |
| Renderer review | `powerpoint_export_slide_image` |

If PowerPoint exposes a reconstructable semantic object and the MCP supports it, use it. Never substitute a screenshot.

## Inventory before drawing

Use the Designer's specification or extract an inventory from the reference. Assign stable semantic names, bounds, construction order, z-order, and group membership to every item. Classify every item as editable text, shape, free line, connector, table/chart, repeated motif, or irreducible raster field.

## Enforce atomic images

Use `powerpoint_add_image` only for one tightly scoped irreducible visual field. Require:

- a specific `raster_reason`;
- `source_is_tightly_cropped=true` or explicit crop fields;
- `atomic_raster_unit=true`;
- `contains_reconstructable_content=false`;
- a precise `decomposition_note`.

Split prediction grids, mask comparisons, channel stacks, microscopy arrays, and before/after blocks into separate pictures. Rebuild all text, frames, grid lines, legends, arrows, axes, tables, and regular plots as native objects.

## Draw one region at a time

1. Establish slide size, margins, panel bounds, alignment anchors, spacing tokens, z-order, and connector lanes.
2. Draw one logical region from background to foreground with stable names and nonzero pacing.
3. Use fixed text geometry, explicit margins, wrapping, alignment, and controlled autofit.
4. Use attached connectors for semantic relationships; use free lines for axes, ticks, separators, and deliberate annotations.
5. Apply start/end clearance so free arrowheads do not enter rectangles.
6. Use exact align/distribute and table-layout tools instead of visual guessing.
7. Group a region only after its internal objects remain individually editable and its local gate passes.

## Mandatory Reviewer-Corrector loop

After each completed region:

1. Export the current slide through `powerpoint_export_slide_image`.
2. Run `powerpoint_audit_figure` and inspect named objects.
3. Give structure and renderer evidence to `$audit-scientific-figure`.
4. If it reports any finding, give the findings to `$correct-scientific-figure`.
5. Execute the returned object-level operations.
6. Export and audit again.

Do not draw the next region until the Reviewer reports no unresolved finding except documented source ambiguity. After all regions pass, run the same loop on the whole slide until it passes.

## Acceptance gate

Require exact readable semantics, 1.00 reconstructable editability, 1.00 clipping/overlap safety, at least 0.95 layout/alignment confidence, at least 0.95 connector clarity, at least 0.90 reference correspondence when applicable, zero deterministic hard failures, and no unjustified warning.

## Delivery

Inspect once more, save the editable `.pptx` with `powerpoint_save`, and export PDF only when requested. Report stable object counts, native/table/chart/group counts, picture count, every raster declaration, local and whole-slide Reviewer results, and remaining ambiguity.

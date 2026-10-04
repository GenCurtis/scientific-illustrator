# Changelog

## 1.5.4-gcSIfix-6 — 2026-10-04

- Generalized the README for agent-neutral use: installation is organized by environment (Codex, OpenCode, Antigravity, and any Agent Skills + MCP host), the prompts no longer require the Codex-only `plugin://` mention, and the hardcoded version line plus the release table were replaced with links to `CHANGELOG.md` and the tags page so no duplicated release list can go stale.
- README PowerPoint/WPS prompts now describe bounded batches and checkpoint review instead of per-region stepping, matching the shipped workflow.
- User-visible copy no longer names Codex: the Mac PowerPoint task pane status/help text, the Office.js setup next steps, and both language versions of `PRIVACY.md` now address the user's AI agent instead.

## 1.5.4-gcSIfix-5 — 2026-10-04

- Review-debt checkpoint reminder: mutation results (single actions and `powerpoint_draw_sequence`) carry a `review_reminder` once `mutations_since_last_render` crosses the configurable review-debt threshold (default 25; override with `SCIENTIFIC_ILLUSTRATOR_REVIEW_DEBT_THRESHOLD`). The reminder reports both debt values and tells the agent to render and audit at the next checkpoint; a fresh render clears it. Evidence tools and status never carry the reminder, and inner sequence operations stay clean because only top-level mutation results are annotated.
- Tests: `discipline-counter-smoke.mjs` verifies the threshold override, single and batch reminder behavior, and reminder-free evidence tools; the COM live suite adds a trigger-and-clear step (now 50 steps). The workflow contract lint requires the skill and the `draw_sequence` description to document the reminder.

## 1.5.4-gcSIfix-4 — 2026-10-04

- Session discipline counters: the server tracks a content revision (advanced by every mutation, exact for batches via `operations_applied`) and, for each evidence tool (`powerpoint_inspect`, `powerpoint_audit_figure`, `powerpoint_export_slide_image`), the revision and scope last observed. Results and `powerpoint_status` carry a `discipline` block with `unchanged_since_last_call`, `redundant_inspects/audits/renders`, `mutations_since_last_inspect/audit/render`, and `stale_review`. Repeating an unchanged review is counted instead of silently wasted; review debt after edits stays visible. Different scopes are never counted redundant, and counters reset on new/closed presentations.
- New CI-safe `scripts/discipline-counter-smoke.mjs` (OOXML, no application needed) plus a COM live-suite step verify counting, scope handling, batch revision math, and review-debt clearing. The workflow contract lint now requires the skill to document the counters.

## 1.5.4-gcSIfix-3 — 2026-10-04

- PowerPoint-only port of upstream PR #17 (v1.6.0) runtime pieces: bounded OOXML draw batches with one Python process and one PPTX load/save per batch, successful-prefix recovery on failure, stdin payloads for large UTF-8 batches, zero-delay sequence default, preflight sequence validation, and the read-only `powerpoint_plan_reconstruction` routing planner. Draw.io and macOS parts are intentionally not imported.
- Windows COM batching (fork extension, not upstream): `powerpoint_draw_sequence` executes bounded batches in one PowerShell process with a cached application reference. Measured on this machine for 30 native shapes: 29.1 s before, 4.2 s with default checkpoint batches, 3.5 s with fast batches (~7–8x). Partial failures report the exact index and keep the committed prefix.
- Condensed workflow rules in `edit-powerpoint-live`: bounded zero-delay batches, representative-module reuse, checkpoint review, targeted corrections, and a three-attempt correction budget. The full upstream `adaptive-workflow.md` reference is intentionally not imported to keep skill text lean.
- New tests: adaptive planner/MCP contract tests wired into `npm test`; batch unit tests (PPTX part-level equivalence, read-only guard, failure isolation); OOXML performance and failure-recovery benchmark script (manual, requires python-pptx); live suite extended to 44 steps with COM batch and partial-failure assertions.

## 1.5.4-gcSIfix-2 — 2026-10-03

- Fork version suffix: plugin, package, and README now report `1.5.4-gcSIfix-2`; the Office.js manifest keeps the numeric `1.5.4.0`, and the repository validator checks the suffix against its numeric base.
- Removed every legacy author attribution from agent-facing skills, Office add-in metadata, and task-pane assets; the fork now identifies as GenCurtis and guards the nine agent-visible files against attribution regressions.
- Fixed Windows COM PDF export (now `SaveCopyAs` with the PDF format) and the polluted `[true, {...}]` chart response shape.
- Added the 42-step Windows PowerPoint live matrix (`npm run test:live`): real COM mutations, PNG/PPTX/PDF exports, python-pptx round-trip, native OMML checks, and background-window assertions.
- Background windows: under the default preserve policy, a newly launched PowerPoint window opens minimized and immediately returns focus; attaching no longer maximizes the window; chart-data Excel windows are hidden (application level when Excel was not running, workbook window level otherwise).
- Native OMML equations: new `powerpoint_add_equation` tool converts LaTeX through Microsoft Word's MML2OMML.XSL. The COM backend transfers the equation through a hidden Word document and the clipboard; the OOXML backend injects `<a14:m>` directly. Both routes keep equations editable and vector-crisp, verified by the live suite and a CI-safe OOXML equation smoke test.

## 1.5.4 — 2026-08-08

- Updated the author, developer, Office add-in provider, task-pane, license, README, and successful-delivery attribution to `一个地质博士`.
- Removed every remaining legacy author label from the plugin package.
- Synchronized the plugin, MCP server, Office.js manifest, documentation, and validation metadata at version 1.5.4.

## 1.5.3 — 2026-08-01

- Fixed macOS WPS discovery for the localized application path, environment overrides, Bundle ID lookup, and exact main-process matching.
- Replaced false-positive status with separate installed, running, managed-file, open-dispatch, document-open, and refresh-verification states. Unknown WPS states remain `null` instead of becoming success.
- Locked both backend and target application after the first presentation mutation, so an explicit WPS request can never reuse a PowerPoint COM/Office.js session; sequence-level host selection is propagated to every operation.
- Isolated the OOXML working-copy state per MCP process by default, preventing concurrent Codex tasks from overwriting or redirecting one another's PowerPoint/WPS session.
- Serialized stateful MCP requests within each server, preventing parallel tool calls from racing on PPTX state or draw.io canvas mutations and losing objects.
- Refused editable OOXML copies of `.pptm` and `.ppsx` instead of risking macro loss or content-type changes; those formats remain available to Windows COM or read-only OOXML inspection.
- Enforced output extensions for PPTX, PDF, PNG, and JPEG across file-backed and Office.js saves/exports instead of writing valid bytes under misleading filenames.
- Added checked `open -b com.kingsoft.wpsoffice.mac` dispatch, macOS `lsof` verification, safe activation/quit behavior, and an explicit `powerpoint_refresh` tool.
- Made Mac PowerPoint file-backed refresh/close target the exact application-reported directory plus filename instead of a potentially ambiguous duplicate name; replaced unreliable `lsof`-only window detection and unstable AppleScript object references with bounded indexed checks.
- Blocked automatic Mac PowerPoint reload when the managed window contains unsaved user edits, preventing checkpoint refresh from discarding manual changes.
- Changed OOXML sequences to checkpoint refresh by default while still saving each native object; `fast` refreshes once and explicit `per_object` remains available.
- Added Windows WPS environment/PATH/registry/versioned-path discovery, exact `wpp.exe`/`wpsoffice.exe` process parsing, `py -3` runtime support, and PowerShell syntax plus non-mutating COM status checks.
- Extended Windows WPS discovery to configured product roots and both 32-bit/64-bit App Paths registry views.
- Added Windows/macOS draw.io path regression tests and a GitHub Actions matrix for Ubuntu, macOS, and Windows. Public runners do not contain commercial PowerPoint/WPS applications, so simulated checks are never reported as real application integration.
- Rejected unknown or unloaded draw.io shape/stencil names instead of allowing the renderer to silently substitute a rectangle; capabilities now expose the live stencil registry.
- Separated free-line and attached-connector routing: coordinate lines now follow exact endpoints/waypoints without automatic orthogonal doglegs, while attached connectors keep square-corner orthogonal routing unless curvature is explicit.
- Fixed group-shape updates, table-layout length validation, and previously ignored arrowhead updates; file-backed status no longer equates a running process with an in-memory application connection.
- Tightened editable table/chart behavior across OOXML, Office.js, and COM: unsupported mutations now fail explicitly, transparency and banding are preserved, scatter x-values remain numeric, and editable axis titles are emitted where supported.
- Rejected oversized table data and out-of-range cell overrides instead of truncating them, and made banded-row parity consistent for any header-row count.
- Made Office.js, OOXML, and COM shape lookup reject ambiguous duplicate names and added duplicate-name hard findings so correction calls cannot silently edit the wrong object.
- Added WPS reliability tests, real Mac PowerPoint/WPS/draw.io integration checks, concise usage guidance, and synchronized plugin, MCP, and Office.js version metadata.

## 1.5.2 — 2026-08-01

- Replaced unsupported SVG manifest icons with validated 32 px and 64 px PNG assets so Mac PowerPoint no longer silently ignores the Office.js add-in.
- Added the correct `image/png` response type and regression checks for manifest icon paths, dimensions, MIME types, and synchronized release versions.

## 1.5.0 — 2026-07-30

- Added a sideloadable Microsoft PowerPoint Office.js task pane for macOS with direct `PowerPoint.run()` and per-object `context.sync()` updates in the current deck.
- Added a loopback-only HTTPS command bridge with a random session token, authenticated long polling, acknowledgements, heartbeat detection, size limits, and protocol timeout tests.
- Added automatic backend selection and session locking: Windows PowerPoint COM first, connected Mac PowerPoint Office.js next, then the existing WPS/Mac OOXML fallback.
- Added explicit `per_object`, `checkpoint`, and `fast` pacing modes without calling file refresh "live".
- Added editable geometry-backed arrow/connector and regular-chart composites for Office.js API gaps, with capability and result declarations instead of overstating native support.
- Added Office.js slide rendering and editable PPTX export, pre-cropped atomic-image enforcement, local certificate generation, and Mac manifest sideload helpers. Certificate trust remains a manual user decision.
- Fixed Office.js whole-slide audit classification so inspected lines and images use the normalized `shape_type` inventory field, and added a regression guard plus Office.js type validation.
- Added bilingual Windows/macOS × draw.io/PowerPoint/WPS compatibility, versioned-release, and rollback documentation. The first public `v1.3.0` release remains available alongside `v1.5.0`.

## 1.4.0 — 2026-07-29

- Added native editable PPTX support for Microsoft PowerPoint on macOS through a safe file-backed OOXML bridge.
- Added WPS Presentation compatibility on Windows and macOS using the same standard PPTX object model.
- Added automatic application discovery and explicit `auto`, `powerpoint`, and `wps` host selection.
- Preserved the Windows Microsoft PowerPoint COM backend as the fastest live-editing path.
- Added local Mac/WPS capability reporting, deterministic structure audit, isolated working copies, and LibreOffice/Poppler preview rendering.

## 1.3.0 — 2026-07-24

- Published as the new `scientific-illustrator` project.
- Integrated and upgraded the earlier `drawio-scientific-illustrator` research project.
- Added live Microsoft PowerPoint control through the native Windows COM object model.
- Preserved and expanded live draw.io graph-API drawing, file validation, and export.
- Added equivalent capability discovery and object operations for PowerPoint and draw.io.
- Added a backend-neutral Designer–Drawer–Reviewer–Corrector workflow.
- Added panel-by-panel local quality gates and repeated whole-figure review.
- Added deep editability review and atomic-raster enforcement so editable content is not needlessly flattened.
- Added deterministic alignment, distribution, z-order, grouping, table, chart, and connector-clearance operations.
- Added bilingual installation, usage, migration, privacy, and troubleshooting documentation.

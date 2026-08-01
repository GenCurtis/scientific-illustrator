# Changelog

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

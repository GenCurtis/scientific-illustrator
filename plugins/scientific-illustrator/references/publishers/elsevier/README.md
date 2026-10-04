# Publisher adapter: Elsevier (baseline)

Scope: `paper-figure`. Machine-readable rules live in `baseline.json`; this
README is the human-readable summary and source list.

## Key requirements (as checked)

- Halftone raster: 300 dpi minimum.
- Combination line + halftone: 500 dpi minimum.
- Line art raster: 1000 dpi minimum.
- Typical target widths: 30 / 90 / 140 / 190 mm (minimum / single column /
  one-and-a-half column / double column).
- Recommended fonts: Arial, Helvetica, Courier, Symbol, Times, Times New Roman.
- Vector preferred; hybrid artwork keeps RGB for color tonal areas, bitmaps
  still need effective resolution, and fonts must be embedded.
- Line weight guidance: approximately 0.1–1.5 pt; the FAQ recommends 0.25 pt as
  the working minimum (0.1 pt is the absolute minimum) and roughly 1 pt for
  prominent lines.

## Provenance

- `checked_at`: 2026-10-04, `retrieved_by`: manual-audit.
- Official source: Elsevier artwork and media instructions (see `source_urls`
  in `baseline.json`).
- Journal-specific author instructions may override these values; the
  resolver reports this in its runtime statement.

## Maintenance

Manual review at least once per year (or before a strict submission). Update
values and `checked_at`; never change `id`.

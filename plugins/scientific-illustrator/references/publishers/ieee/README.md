# Publisher adapter: IEEE (baseline + graphical abstract)

Scope: `paper-figure` and `graphical-abstract` for `baseline.json`;
`graphical-abstract` for `graphical-abstract.json`. When a graphical abstract
targets IEEE, the resolver applies both files (baseline first, then the
profile-specific spec).

## Key requirements (as checked)

- Color and grayscale raster images: greater than 300 dpi (strict comparison
  preserved; the spec uses `"comparison": "greater-than"`).
- Black-and-white line art: greater than 600 dpi.
- Typical widths: 88.9 mm (single column) / 182 mm (double column).
- Accepted formats: PS, EPS, PDF, PNG, TIFF.
- Office files are acceptable only when the artwork was originally drawn in
  an Office program.
- Recommended fonts: Helvetica, Times New Roman, Arial, Cambria, Symbol; embed
  fonts or convert text to outlines.
- Full-size text: approximately 9–10 pt.
- Accessibility: do not rely on color alone (use shape / dash patterns) and
  keep categories distinguishable in grayscale.
- Graphical abstract: 660 × 295 px, at least 300 dpi (inclusive — unlike the
  strict ">300" for article graphics), text at least 16 px (approximately
  12 pt).

## Provenance

- `checked_at`: 2026-10-04, `retrieved_by`: manual-audit.
- Official source: IEEE Author Center "Create graphics for your article"
  (see `source_urls` in each JSON file).

## Maintenance

Manual review at least once per year (or before a strict submission). Update
values and `checked_at`; never change `id`.

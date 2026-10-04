# Publisher adapter: ACM (baseline)

Scope: `paper-figure`.

## Key requirements (as checked)

- Accepted raster formats: TIFF, JPEG.
- Scalable formats strongly preferred: SVG, EPS, PS.
- Application-native graphics are not recommended.
- Fonts must be embedded.
- Raster DPI: no universal number is published by ACM; the requirement is
  venue-specific. The spec keeps this field explicitly `unknown` instead of
  inventing a value.
- Accessibility: meaningful figures require a figure description / alt text
  that does not merely repeat the caption; the LaTeX target is
  `\Description{...}`.

## Provenance

- `checked_at`: 2026-10-04, `retrieved_by`: manual-audit.
- Official sources: ACM author submission guidelines (see `source_urls` in
  `baseline.json`).

## Maintenance

Manual review at least once per year (or before a strict submission). Update
values and `checked_at`; never change `id`.

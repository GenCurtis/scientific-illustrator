# Venue adapter: egu-ga (EGU General Assembly)

Verified venue constraints for the EGU General Assembly (European Geosciences
Union), the annual conference where EGU poster boards and presentation uploads
are governed by official presenter guidelines.

## Source

- Poster presenter guidelines (EGU26):
  https://www.egu26.eu/authors/presenters/poster_presenter_guidelines.html
- Presenter guidelines index (EGU26):
  https://www.egu26.eu/authors/presenters.html
- Checked: 2026-10-04. Re-verify annually or before a strict submission and
  update `checked_at`; the `id` stays stable across updates.

## Machine-readable rules

`baseline.json` (profiles: poster, slides):

- `min_font_pt: 16` — "EGU recommends that you do not use a font size smaller
  than 16pt" (poster text should be readable at 1.5–2.0 m).
- `accessibility.non_color_encoding: true` — the guidelines ask for different
  colours or line types per series and colour-vision-deficiency-safe schemes.

`poster.json` (profile: poster):

- `orientation: "landscape"`, `canvas_mm: [1978, 1183]` — "Poster boards are in
  landscape format, and authors can make use of the full dimensions of 1978 mm
  width × 1183 mm height."
- `delivery.format: "pdf"`, `delivery.page_count: 1`,
  `delivery.max_file_size_mb: 50` — "Your poster file must be a one page PDF
  file. The file size is limited to 50 MB."

Note on resolution semantics: the venue values are requirement floors. Profile
quality documents may recommend stricter values (for example a larger poster
body size for readability); when the venue adapter is applied it wins the
last-wins chain, so the resolved value is the venue requirement, not the
quality recommendation.

## Requirements that stay prose (not machine-readable)

- Display EGU's official photography-permission graphic on the poster
  (encourage / do not permit photos and screenshots).
- Title, authors, and contact information at the top; content covers the same
  material as the abstract.
- Label elements as 1, 2, 3 or A, B, C so viewers can follow the display;
  structure background → results → conclusions; the poster must be
  self-explanatory.
- Credit all third-party images (including Wikipedia and imaggeo); follow
  United Nations naming conventions on maps and avoid contested borders.
- Upload the live presentation file at least 24 hours before the session;
  supplementary materials are optional (PDF/PPT/PNG/JPG/MP4; 50 MB cap per
  abstract, 200 MB for MP4).
- Adding the abstract QR code is asked of OSPP contestants and encouraged for
  everyone else.

# Publisher adapter: Springer Nature (baseline, conservative)

Scope: `paper-figure`.

## Key requirements (as checked)

- Digital artwork is required.
- High-resolution / editable source files are preferred.
- Journal-specific instructions must be checked when available.

This adapter deliberately stays at the group level. Springer Nature has no
group-wide numeric artwork page: concrete formats and resolutions (EPS
preferred for vector, fonts embedded, typically 1200 dpi line art / 300 dpi
halftone / 600 dpi combination) live in journal-level "Artwork and
Illustrations Guidelines" and book-level guidelines, so the target journal's
Instructions for Authors must be checked. Nature Research has stricter,
more specific artwork guidelines; do not generalize them to all of Springer
Nature. A separate `nature-research` adapter can be added later.

## Provenance

- `checked_at`: 2026-10-04, `retrieved_by`: manual-audit.
- Official source: Springer Nature artwork guidelines (see `source_urls` in
  `baseline.json`).

## Maintenance

Manual review at least once per year (or before a strict submission). Update
values and `checked_at`; never change `id`.

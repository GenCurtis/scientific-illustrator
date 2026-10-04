# profile: paper-figure

A figure destined for a journal article body (print and/or PDF), read at final size, cited from the text.

## 质量检查清单

- **Final-size readability** — every label legible at the printed column width; a small, consistent type-size hierarchy.
- **Vector-first** — text, lines, arrows, and shapes stay vector/editable; raster only where irreducible and declared.
- **Panel hierarchy** — the primary result is obvious; supporting panels are subordinate; labels follow reading order.
- **Caption-ready** — panels are self-explanatory together with the caption; abbreviations the caption cannot define appear in-figure.
- **Scientific clarity** — high data-ink ratio; no chartjunk; uncertainty and `n` visible; comparisons honest (no unmarked truncated axes).
- **Accessibility** — colorblind-safe palette, grayscale-printable, contrast sufficient for small text.
- **Consistency** — palette, fonts, line weights, and arrow semantics come from the manuscript style contract; new conditions are registered in `style.semantic_styles` instead of invented per figure.

## profile_settings（宽松默认）

`journal`, `column_class` or `canvas_mm`, `min_font_pt`, `min_raster_dpi`, `vector_required`, `panel_label_scheme`, `export_targets`. Official publisher numbers resolve in the publication-compliance layer — this profile provides loose defaults and quality principles only.

## Recreation policy interplay

`faithful`: profile rules are advisory; reference fidelity wins. `publication-ready`: accessibility, export compliance, and clear typography/spacing defects may be corrected; scientific truth never changes.

## 常见失败模式

- Rasterized text; hairline strokes that vanish in print; fonts below final-size legibility.
- Style drift across the manuscript's figures.
- Overloaded single panels; missing units, `n`, or uncertainty.
- Color as the only differentiator.

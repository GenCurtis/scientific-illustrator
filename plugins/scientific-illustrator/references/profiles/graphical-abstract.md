# profile: graphical-abstract

A single visual summary submitted alongside a paper (journal TOC / online listing), seen small and without the caption.

## 质量检查清单

- **Single core message** — one idea, graspable immediately.
- **Thumbnail-first** — the structure reads at thumbnail size (test by shrinking to `profile_settings.thumbnail_test_width`); large shapes, few words.
- **Caption-independent** — no unexplained abbreviations; minimal in-figure text (≤ `max_text_words` by default).
- **Visual metaphor accuracy** — the simplification must not misstate the science (integrity).
- **No decorative noise** — no icons, gradients, or shadows that do not carry meaning.
- **Consistency** — the same palette and fonts as the manuscript style, so the abstract belongs to the paper.

## profile_settings（宽松默认）

`canvas` (journal spec), `max_text_words`, `thumbnail_test_width`, `min_raster_dpi`, `export_targets`.

## Recreation policy interplay

Same semantics as paper-figure: `faithful` keeps the reference look; `publication-ready` may simplify and clean but never alters meaning.

## 常见失败模式

- A shrunken paper figure; dense panels; tiny labels.
- Text-heavy poster-style layout.
- A metaphor that oversimplifies into inaccuracy.
- A visual language different from the paper's figures.

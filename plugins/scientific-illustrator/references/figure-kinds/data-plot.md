# kind: data-plot

## 适用与识别信号

One quantitative panel whose primary content is measured or derived data: trends, distributions, correlations, matrices. Signals: axes with quantities and units, series, error bars, statistical annotations. When the figure contains two or more coordinated data panels, use `multi-panel-data` instead.

## semantic primitives

- axis (quantity + unit), scale (linear / log), series, marker, line, bar / band, error bar / confidence interval, reference line, threshold, annotation, legend
- single facet only when trivial; anything more is `multi-panel-data`

## layout archetypes

- **trend** — ordered x quantity (time, dose, distance) with one line per series
- **comparison** — categorical axis with grouped bars / box / violin; A-vs-B and before-vs-after pairs live here
- **matrix** — heatmap / contour with a shared color scale and a labeled colorbar

## 编码约定

- Position encodes magnitude before length; length before color. Never encode the primary comparison with color alone.
- Compared panels share scales; when scales differ, state it explicitly in the figure or caption.
- Uncertainty: error bars / intervals defined in the caption or in-figure; `n` reported.
- Palette from the manuscript style (categorical / sequential tokens); colorblind-safe and grayscale-printable.
- Direct labeling preferred over legends for 2–3 series; legend order follows visual order.
- Axis breaks must be marked; log axes labeled; truncated axes never imply a zero baseline that is not there.

## 常见失败模式

- Truncated axis exaggerating differences; dual y-axes implying a correlation that was not measured.
- Rainbow / jet palettes; red-green-only encoding; 3D bars or pies; chartjunk (shadows, gradients, textures).
- Missing units, `n`, or uncertainty definition; inconsistent decimal precision across panels.
- Mean-only bars when the distribution is the message.

## 与其他 kind 的边界

- `multi-panel-data` — two or more coordinated quantitative panels with labels a/b/c.
- `process` / `mechanism` — conceptual relationships, no measured data.
- `image-panel` — a quantitative panel that is secondary to an acquired image.
- `temporal` patterns are not a figure kind: temporal patterns (timeline, phase) appear inside data-plot when they carry measured values; pure event sequences without data belong to `process` or `experimental-workflow`.

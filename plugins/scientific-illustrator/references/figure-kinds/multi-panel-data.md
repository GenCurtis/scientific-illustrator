# kind: multi-panel-data

## 适用与识别信号

Two or more coordinated quantitative panels that must be read as one figure: panel labels, shared legends, aligned axes, cross-panel color mapping. Signals: "a/b/c", left/right, top/bottom, shared scales, condition grids.

## semantic primitives

- panel, panel label, shared axis, alignment grid, figure-level legend, cross-panel highlight, quantitative inset
- annotation transfer: the same color/marker means the same condition in every panel

## layout archetypes

- **grid** — uniform related panels (e.g., 2×2 conditions)
- **hero + support** — one large primary result with two or three small supporting panels
- **shared-axis rows/columns** — each row or column shares one scale; alignment itself carries the comparison

## 编码约定

- One panel = one message. Label every panel in reading order (a, b, c) and reference labels in the caption.
- Semantic identity → visual identity across panels: same condition = same color / marker / line style (`style.semantic_styles`).
- Shared axes aligned and visually identical; differing scales explicitly marked.
- Figure-level legend once, not per panel; panel-local legends only when unavoidable.
- Reading order left→right, top→bottom unless explicitly indicated.

## 常见失败模式

- Inconsistent scales presented as comparable; misaligned axes.
- Repeated legends and annotations bloating the figure.
- Color meaning drifting across panels (blue means control in panel b and treatment in panel c).
- Panel labels colliding with content or out of reading order.

## 与其他 kind 的边界

- `data-plot` — a single quantitative panel.
- `mixed-composite` — panels of different kinds (data + workflow + image); multi-panel-data is data-only.
- `image-panel` — multiple micrographs whose quantitative panels dominate become multi-panel-data with image content.

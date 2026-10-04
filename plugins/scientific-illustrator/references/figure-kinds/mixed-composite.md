# kind: mixed-composite

## 适用与识别信号

The figure combines several kinds (for example workflow + data plots + a micrograph). This is the explicit fallback kind: prefer a single dominant kind when one structure covers the figure; use `mixed-composite` when no kind covers roughly 70% or more of the content. Record per-panel kinds in the design plan when known.

## semantic primitives

- panel, per-panel kind, figure-level reading order, shared legend, cross-panel reference, common visual language

## layout archetypes

- **workflow-with-data** — process schematic plus supporting measurements
- **image-with-quantification** — micrograph plus summary plot
- **hero + support panels** — one dominant structure with satellite evidence

## 编码约定

- One shared visual language: the same palette, fonts, line weights, and arrow semantics across all panels (manuscript style).
- Panel labels in reading order; the caption maps labels to kinds.
- Legends consolidated at figure level; avoid per-panel legend repetition.
- Cross-references between panels (same color / marker) must be deliberate and documented, not accidental.
- Reading order stated when it is not the default (left→right, top→bottom).

## 常见失败模式

- Style clash between panels (different palettes, fonts, arrow styles).
- Duplicated legends and repeated annotations; no hierarchy when one panel is primary.
- Terminology drift across panels (the same object named differently).
- Each panel drawn by a different kind grammar without a shared visual language.

## 与其他 kind 的边界

- All other kinds: choose them when a single structure dominates. `mixed-composite` is the fallback and must state its composition explicitly.

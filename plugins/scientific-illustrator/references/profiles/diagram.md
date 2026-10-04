# profile: diagram

Fallback profile for figures without a specific delivery context (internal diagrams, drafts, schematics).

## 质量检查清单

- **Labels readable**; hierarchy clear.
- **Palette consistent** with the project style when one exists.
- **Editability** — reconstructable shapes and text; atomic rasters only with a reason.
- **No decorative noise**; no rasterized text.

## profile_settings（宽松默认）

`export_targets`.

## Recreation policy interplay

`faithful` by default; `publication-ready` applies the same corrections as paper-figure when the diagram is headed for publication.

## 常见失败模式

- Unlabeled or overlapping shapes; inconsistent connector semantics.
- A style that does not match the manuscript the diagram will join.

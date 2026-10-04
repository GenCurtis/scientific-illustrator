# kind: image-panel

## 适用与识别信号

The primary content is one or more acquired images: micrographs, medical imaging, remote sensing, photographs. Signals: texture, field of view, scale bars, channels, insets.

## semantic primitives

- image, field of view, scale bar, annotation overlay, inset, channel, lookup table (LUT), crop indicator

## layout archetypes

- **single image + inset** — overview with a magnified detail
- **channel composite** — the same field across channels, merged or side by side
- **condition pair** — matched fields of view (before/after, control/treatment)
- **image + quantification** — image beside its quantitative summary (becomes `multi-panel-data`)

## 编码约定

- Scale bar on every image, or explicit magnification plus stated field width; insets carry their own scale bar.
- Channel / LUT consistency across panels; merged images state the channel-to-color mapping.
- Annotations (arrows, ROIs, labels) high-contrast, consistent color, minimal count.
- Any crop shown with a crop indicator; brightness / contrast adjustments applied uniformly and stated (integrity — never selectively enhance).
- Match fields of view across compared conditions, or state that the images are representative.

## 常见失败模式

- Missing scale bar; unmarked crops; inconsistent LUTs across panels.
- Overlaid text unreadable against busy backgrounds; annotation clutter.
- Selective enhancement or spliced images (integrity failure).
- Comparing representative images without stating variability.

## 与其他 kind 的边界

- `multi-panel-data` — quantitative panels dominate.
- `spatial` — maps and sections with coordinate systems.
- `data-plot` — no acquired image content.

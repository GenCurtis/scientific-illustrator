# kind: spatial

## 适用与识别信号

Geographic, geological, or anatomical space: maps, cross-sections, sections, region diagrams. Signals: orientation (N arrow), coordinates, depth / height axes, unit boundaries, overlays.

## semantic primitives

- region, boundary, section line, depth / height axis, overlay, scale, orientation marker, legend (units), projection

## layout archetypes

- **plan map** — top-down view with orientation and scale
- **cross-section** — vertical slice with a depth axis and unit boundaries
- **layered section** — stacked units with labels and boundary lines
- **map + callout** — overview with detailed insets connected by markers

## 编码约定

- Orientation and scale on every map or section; the section location shown on the plan view.
- Depth / height axes with units; vertical exaggeration stated when used.
- Unit and region colors from the manuscript palette; boundaries visually distinct from data overlays.
- Overlay data (contours, stations, anomalies) separable from the base geography; transparency consistent.
- Legend maps every color or pattern to a unit or variable.

## 常见失败模式

- Missing scale or orientation; unstated projection distortion.
- Unreadable overlays on busy base maps; rainbow elevation ramps.
- Unstated vertical exaggeration; sections without a location reference.
- Decorative terrain shading competing with the data.

## 与其他 kind 的边界

- `image-panel` — raw imagery without coordinate structure.
- `process` — cycles and fluxes; a spatial map of fluxes stays process when the cycle is primary.
- `data-plot` — data on a coordinate axis, not in geographic space.

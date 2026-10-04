# kind: network

## 适用与识别信号

Abstract relational structure: node-link graphs, connectivity maps, co-occurrence networks, pathway graphs. Signals: nodes and edges, hubs, clusters, weights. No engineered interfaces and no causal arrow semantics unless stated.

## semantic primitives

- node, edge, weight, direction, cluster / module, hub, layout (positioning), attribute encoding

## layout archetypes

- **node-link** — force-directed or structured layout
- **hub-spoke** — a dominant node with radiating connections
- **matrix / adjacency** — grid of pairwise relations for dense networks
- **layered network** — nodes ordered by a hierarchy or flow

## 编码约定

- Every visual channel has one meaning and a legend entry: node size, node color, edge width, edge color, direction.
- Layout stability: the same network keeps the same layout across figure versions (record the layout source or seed) — moving nodes destroys cross-figure comparison.
- Prefer the matrix view when edges are dense; node-link when topology is the message.
- Threshold edges explicitly (weight cutoff) and state it.

## 常见失败模式

- Hairball with unreadable structure; no threshold stated.
- Unstable layouts between versions; unlabeled encodings.
- Implying direction or causality where none exists; cluster boundaries drawn without a statistical basis.
- Decorative node styles fighting the data.

## 与其他 kind 的边界

- `system-architecture` — engineered components and interfaces.
- `mechanism` — causal semantics with distinct arrow types.
- `data-plot` — a matrix heatmap of measured values (a network matrix encodes adjacency, not magnitude).

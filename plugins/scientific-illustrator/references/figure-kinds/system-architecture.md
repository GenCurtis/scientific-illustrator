# kind: system-architecture

## 适用与识别信号

Engineered systems: software pipelines, instrument suites, sensor networks, data processing chains. Signals: components, interfaces, protocols, data stores, layers, deployment boundaries.

## semantic primitives

- component, interface, data store, process, actor, protocol, boundary / trust zone, dependency, message / flow

## layout archetypes

- **layered** — stacked layers with downward dependencies
- **pipeline** — left→right processing stages with data between stages
- **client-server / hub** — a central service with clients around it
- **deployment / mesh** — grouped services with explicit boundaries

## 编码约定

- Component type (service, store, actor) expressed consistently by shape or icon.
- Data and control flow direction explicit; protocols and labels on the edges.
- Boundaries (trust zones, deployment groups, hosts) drawn as containers with consistent style.
- Legend for icons whenever more than two component types appear.
- Vendor logos only when required; they must not carry the semantic load.

## 常见失败模式

- Uniform boxes losing component-type semantics; icon salad.
- Crossing wires; bidirectional edges without direction; missing protocol labels.
- Physical deployment and logical architecture mixed in one layer without separation.
- Unlabeled boundaries implying isolation or security that does not exist.

## 与其他 kind 的边界

- `experimental-workflow` — physical lab procedure.
- `network` — abstract graph topology without engineered interfaces.
- `mixed-composite` — architecture combined with data plots.

# kind: mechanism

## 适用与识别信号

Causal relationships in a natural system: molecular pathways, signaling, chemical mechanisms, biological interactions. Signals: activation / inhibition verbs, molecules and entities, feedback, compartments (cell, membrane, organelle).

## semantic primitives

- entity, activation, inhibition, conversion, transport, feedback (positive / negative), compartment, annotation

## layout archetypes

- **causal-flow** — left→right or top→bottom cause chain
- **compartmental** — containers (cell, membrane, tissue) with processes inside or at boundaries
- **cyclic** — closed regulatory loop (cell cycle, signaling cycle)
- **hub-spoke** — a central regulator with radiating targets

## 编码约定

- Arrow semantics are the core grammar: activation, inhibition, transport, and conversion must be visually distinct and defined in a legend whenever more than one type appears.
- Compartments drawn as consistent containers; entities stay inside their compartment, crossing only with transport semantics.
- Feedback loops labeled with sign (+ / −) or a legend entry.
- Molecule shapes schematic, never decorative; avoid photorealistic renderings that imply scale.
- One arrow semantic per relationship type; never overload one arrow style with two meanings.

## 常见失败模式

- Arrow soup: every entity connected to every other, no reading order.
- Unlabeled or ambiguous arrow types; invented pathways not supported by the source (integrity failure — never draw interactions the source does not support).
- Inconsistent compartment nesting; boundaries crossed without transport semantics.
- Decorative 3D molecules and gradients that reduce clarity.

## 与其他 kind 的边界

- `process` — reservoir / flux cycles at system scale (biogeochemical, hydrological).
- `experimental-workflow` — human procedure, not natural causation.
- `network` — abstract graph topology without causal semantics.
- `system-architecture` — engineered components.

# kind: experimental-workflow

## 适用与识别信号

A protocol or experimental procedure: samples moving through operations and decisions. Signals: verbs ("collect", "incubate", "centrifuge"), decision points, treatment arms, iteration loops. This is human procedure, not natural causation.

## semantic primitives

- input / sample, operation, intermediate, decision, measurement / assay, branch, output, loop, annotation (conditions, durations)

## layout archetypes

- **linear** — single left→right (or top→bottom) chain
- **branched** — a decision splits into arms that may reconverge
- **parallel-lanes** — synchronized arms (control vs treatment) with a shared time axis
- **iterative** — an explicit loop back to an earlier step with an exit condition

## 编码约定

- Direction unambiguous and consistent; primary flow left→right or top→bottom.
- Node shape encodes role: operation (rounded rectangle), decision (diamond), measurement (distinct shape), sample (open shape).
- Lane separation for parallel arms; loop arrows routed outside the main flow.
- Conditions and durations annotate the relevant step, not the whole figure.
- Connectors mean flow, not causation — keep one arrow semantic.

## 常见失败模式

- Mixed metaphors (some steps boxes, some icons) breaking the process reading.
- Crossing connectors; ambiguous direction; missing branch conditions.
- Nodes overloaded with paragraphs; details that belong in the caption.
- Loops drawn without an exit condition.

## 与其他 kind 的边界

- `process` — natural / physical cycles rather than a human procedure.
- `system-architecture` — engineered components and data flow.
- `mechanism` — causal molecular / biological interactions.
- Event sequences without operations are temporal patterns inside `process`, or stay here when operations dominate.

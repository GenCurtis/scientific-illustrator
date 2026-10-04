# kind: process

## 适用与识别信号

Natural cycles and transformations at system scale: biogeochemical cycles, hydrological cycles, ecological succession, staged physical processes. Signals: reservoirs or states with fluxes, cycles, timescales, external forcing.

## semantic primitives

- reservoir / state, flux, transformation, storage, forcing, cycle, timescale, boundary

## layout archetypes

- **cyclic-process** — closed loop with directional fluxes
- **reservoir-flux** — boxes (reservoirs) connected by labeled arrows (fluxes)
- **staged transformation** — a sequence of states with the conditions of each transition
- **cycle + forcing** — a cycle with external drivers annotated around it

## 编码约定

- Directionality explicit and consistent; state the convention (e.g., clockwise) when the layout uses one.
- Flux arrows labeled with the process name and, when available, rates or units; arrow weight encodes magnitude only when stated.
- Reservoir size encodes magnitude only when stated; otherwise uniform and explicitly not proportional.
- Timescales: each step annotated with its timescale, or an explicit "not to scale" note.
- One arrow = one flux; never merge multiple fluxes into one unlabeled arrow.

## 常见失败模式

- Arrow soup with unlabeled fluxes; ambiguous direction.
- Mixed timescales without noting it (instantaneous chemistry beside millennial storage).
- Invented fluxes or values not present in the source (integrity).
- Cyclic layouts where the cycle cannot be followed without crossing lines.

## 与其他 kind 的边界

- `mechanism` — molecular / causal detail; process is system-scale.
- `spatial` — geographic / geological maps and sections.
- `data-plot` — a measured time series stays a data-plot.
- `experimental-workflow` — laboratory procedure.

# Edge cases

Which layouts of a diagram and its table does the hook still read?

```mermaid
flowchart TD
  accTitle: Which steps run?
  startEdge --> finishEdge
```

Element | Source
--- | ---
startEdge | [`start`](../src/orders/edge.ts)

```mermaid
flowchart TD
  accTitle: Which steps run?
  a --> b
```

| not a table

```mermaid
flowchart TD
  accTitle: Which steps run?
  a --> b
```

| Element | Source |
| --- | --- |
| | [`start`](../src/orders/edge.ts) |

```mermaid
pie
  "A" : 1
```

```mermaid
---
title: Where does the traffic go?
---
sankey-beta
Shop,Orders,1
```

> ```mermaid
> flowchart TD
>   accTitle: Which steps run?
>   quoted --> done
> ```
>
> | Element | Source |
> | --- | --- |
> | `quoted` | [`start`](../src/orders/edge.ts) |

```mermaid
sequenceDiagram
  accTitle: Who talks to whom?
  alice->>bob: place order
```

| Element | Source |
| --- | --- |
| `alice` | [`start`](../src/orders/edge.ts) |
| `bob` | [`start`](../src/orders/edge.ts) |

```mermaid
flowchart TD
  accTitle: Which steps run?
  first-->second
```

Something | else
---

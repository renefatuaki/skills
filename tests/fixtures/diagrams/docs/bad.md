# Bad diagrams

Which findings does the diagram hook report?

```mermaid
flowchart TD
  %% the question
  accTitle: Which steps run?
  start["Start"] --> check{"Ok?"
  check -->|yes| done["Done"]
```

| Element | Source |
| --- | --- |
| `start` | [`start`](../src/orders/checkout.ts) |

```mermaid
---
title: Which shape is too new?
---
flowchart TD
  a@{ shape: bucket, label: "Too new" } --> b
```

---
"forge": patch
---

Every `flowchart`, `stateDiagram-v2` and `classDiagram` the diagrams skill draws carries the line `%%{init: {"htmlLabels": false}}%%` before its keyword, so Mermaid draws the labels as SVG text. Without it Mermaid draws each label as HTML in a box it measured at 100 % zoom, and Safari and Chrome cut the text off at any other page zoom, on GitHub as everywhere else. The Stop hook reports `path:line html-labels` for a diagram of these types without the line, in a project with or without Mermaid.

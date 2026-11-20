---
"forge": patch
---

A diagram in the body of a pull request, an issue or a comment now carries the line `%%{init: {"htmlLabels": false}}%%` too, so Safari and Chrome no longer cut its labels off. The line reached only the diagrams in Markdown files, because the Stop hook checks files and this text goes to GitHub through `gh`. A new PreToolUse hook denies a `gh` command whose text holds a `flowchart`, a `stateDiagram-v2` or a `classDiagram` without the line, and the `pull-request` and `issue` skills state the rule where they place the diagram.

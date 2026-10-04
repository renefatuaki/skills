---
"forge": major
---

Add the diagrams skill for Mermaid diagrams of flows and structures, with one question per diagram, the type picked by that question and a table that links each element to its source. A diagram goes in `docs/` or in the README of the folder that holds the code, and a planned state marks what a change adds, changes and removes. A PostToolUse hook parses every mermaid block with the Mermaid of the project and names the diagrams whose table links an edited file. Mermaid stays pinned to the oldest version that GitHub, VS Code and JetBrains render.

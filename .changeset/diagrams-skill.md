---
"clean-code": minor
---

Add the diagrams skill for Mermaid diagrams of flows and structures, with one question per diagram, the type picked by that question, a table that links each element to its source, diagrams placed in docs/ or in the README of the folder that holds the code, a planned state that marks what a change adds, changes and removes, and a PostToolUse hook that parses every mermaid block with the Mermaid of the project and names the diagrams whose table links an edited file. The issue skill shows a changed flow or structure as a diagram in the solution field, the pull-request skill in a Diagram section, and the pull-request skill brings the diagrams a branch touches up to date. The project-docs skill places a diagram of one flow or feature in the README of its folder. The three hooks share their plumbing under hooks/lib/, the documentation hook and the diagram hook also their Markdown parsing, and hooks/README.md shows how they work together.

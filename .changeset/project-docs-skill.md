---
"forge": major
---

Add the project-docs skill for Markdown documentation with one question per file, fixed forms such as Tutorial, links instead of retelling and a markdownlint configuration. Every sentence follows technical-writing, and a diagram of one flow or feature goes in the README of its folder. A PostToolUse hook checks documentation files for long dashes, semicolons, dead relative links, a missing opening sentence and files the README does not link, and reports what markdownlint finds.

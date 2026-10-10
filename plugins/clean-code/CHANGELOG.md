# clean-code

## 0.1.0

### Minor Changes

- 6490ab9: Name the standard formatter and linter for every language of the clean-code skill, oxfmt and oxlint for TypeScript, swift-format for Swift, ktlint for Kotlin, google-java-format with Checkstyle for Java and Ruff for Python, with the configuration to copy under formatting/<language>/, each option commented with the sentence from its schema or documentation. The linters also hold three rules for reading speed where their language allows, at most four parameters, no nested ternary and no else after a return. The formatting reference moves next to them and drops the blank-line rules the linters now enforce.
- 0a4f84f: Add the clean-code skill with topic references for naming, functions, control flow, classes and formatting, and per-language guides for Swift, Kotlin, Java, TypeScript and Python.
- 2b1fb57: Link the plain-text form of a documentation page in comments, `.md` on docs.github.com and code.claude.com, `.patch` on a commit URL, raw.githubusercontent.com for a file, so an agent following the link reads Markdown instead of HTML.
- 32fa4e5: Add the code-comments skill with per-language guides and a PostToolUse hook that checks comments for em-dashes, semicolons, length and unlinked TODOs.
- 9a6d5a6: Add the diagrams skill for Mermaid diagrams of flows and structures, with one question per diagram, the type picked by that question, a table that links each element to its source, diagrams placed in docs/ or in the README of the folder that holds the code, a planned state that marks what a change adds, changes and removes, and a PostToolUse hook that parses every mermaid block with the Mermaid of the project and names the diagrams whose table links an edited file. The issue skill shows a changed flow or structure as a diagram in the solution field, the pull-request skill in a Diagram section, and the pull-request skill brings the diagrams a branch touches up to date. The project-docs skill places a diagram of one flow or feature in the README of its folder. The three hooks share their plumbing under hooks/lib/, the documentation hook and the diagram hook also their Markdown parsing, and hooks/README.md shows how they work together.
- 6a021af: Add the package-manager skill: one table that maps the repository's lockfile to its install, add and run commands, shared by the commit and issue skills.
- 7af2de3: Add the project-docs skill for Markdown documentation with one question per file, fixed forms and links instead of retelling, a markdownlint configuration, a PostToolUse hook that checks documentation files for em-dashes, semicolons, dead relative links, a missing opening sentence and files the README does not link and reports what markdownlint finds, and a clean-code step that keeps the documentation in line with the code.

### Patch Changes

- 0abaf70: Write the bundled scripts in TypeScript, `prefill-url.mts` in the issue skill, `sync-project.mts` in the project skill and the `check-comments.mts` hook, so their inputs and results carry types. Node 24 or newer runs them directly.

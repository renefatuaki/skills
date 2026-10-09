# clean-code

Claude Code skills for clean code, code comments, project documentation and diagrams. The rules are language-neutral, a guide per language carries the casing, the container type and the error idiom for Swift, Kotlin, Java, TypeScript and Python. Nothing here depends on a code host, the documentation skills write GitHub Flavored Markdown and Mermaid, which GitHub, VS Code and JetBrains render alike.

## Requirements

- Node 24 or newer, because the hooks are TypeScript that Node runs directly.

## Installation

```sh
claude plugin marketplace add renefatuaki/skills
claude plugin install clean-code@renefatuaki
```

## Skills

| Skill | What it does |
| --- | --- |
| `clean-code` | names, functions, control flow, classes and vertical layout, with a formatter and linter configuration per language |
| `code-comments` | which comment earns its place, how long it may be, and how it links a symbol |
| `project-docs` | every Markdown file that documents a project, from the README to `docs/` |
| `diagrams` | every Mermaid diagram, parsed with the Mermaid that GitHub, VS Code and JetBrains share |
| `package-manager` | which JavaScript package manager a repository uses and its commands |

The formatter and linter configuration per language lives under [skills/clean-code/clean-code/formatting/](skills/clean-code/clean-code/formatting/). Which rule each tool covers, and where the agent fills the gap, is listed in [coverage.md](skills/clean-code/clean-code/formatting/coverage.md).

## Hooks

Three hooks run after every edit and inform without blocking. [hooks/README.md](hooks/README.md) shows how they work together.

- `check-comments` checks the comments of a source file for em-dashes, semicolons, length and unlinked TODOs.
- `check-docs` checks the prose and the links of a documentation file.
- `check-diagrams` parses the diagrams of a Markdown file and names the diagrams that link the edited file.

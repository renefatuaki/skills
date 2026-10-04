# Hooks

What happens after Claude edits a file?

```mermaid
flowchart TD
  accTitle: What happens after Claude edits a file?
  hooksJson["Start every hook after an Edit or a Write"]
  hooksJson --> checkComments["Check the comments of a source file"]
  hooksJson --> checkDocs["Check the prose and the links of a documentation file"]
  hooksJson --> checkDiagrams["Parse the diagrams of a Markdown file and name the diagrams that link the edited file"]
  checkDocs -->|"when the project has it"| markdownlint["Lint the Markdown syntax"]
  checkDiagrams -->|"when the project has it"| mermaid["Parse one diagram"]
  checkDocs --> markdown["Find the code fences and resolve the links"]
  checkDiagrams --> markdown
  checkComments --> hook["Read the edited file and hand the findings to Claude"]
  checkDocs --> hook
  checkDiagrams --> hook
```

| Element | Source |
| --- | --- |
| `hooksJson` | [`hooks.json`](hooks.json) |
| `checkComments` | [`check-comments.mts`](check-comments.mts) |
| `checkDocs` | [`check-docs.mts`](check-docs.mts) |
| `checkDiagrams` | [`check-diagrams.mts`](check-diagrams.mts) |
| `markdown` | [`lib/markdown.mts`](lib/markdown.mts) |
| `hook` | [`lib/hook.mts`](lib/hook.mts) |

Every hook informs and never blocks an edit. A hook that has nothing to report prints nothing.

- [markdownlint](https://raw.githubusercontent.com/DavidAnson/markdownlint/main/README.md) and [Mermaid](https://raw.githubusercontent.com/mermaid-js/mermaid/develop/docs/config/usage.md) come from the project that is edited, never from this plugin.
- [Claude Code hooks](https://code.claude.com/docs/en/hooks.md) describes the input a hook reads and the output it writes.

# Hooks

What happens when a session starts, before Claude edits a file and after?

```mermaid
flowchart TD
  accTitle: What happens when a session starts, before Claude edits a file and after?
  hooksJson["Start every hook of the event"]
  hooksJson -->|"when a session starts"| sessionContext["Hand Claude the transcript of the session and the root of the plugin"]
  hooksJson -->|"before an Edit or a Write"| loadCommentRules["Deny the edit of a source file until the comment rules are in the context of the agent"]
  hooksJson -->|"after an Edit or a Write"| checkComments["Check the comments of a source file"]
  hooksJson -->|"after an Edit or a Write"| checkDocs["Check the prose and the links of a documentation file"]
  hooksJson -->|"after an Edit or a Write"| checkDiagrams["Parse the diagrams of a Markdown file and name the diagrams that link the edited file"]
  checkDocs -->|"when the project has it"| markdownlint["Lint the Markdown syntax"]
  checkDiagrams -->|"when the project has it"| mermaid["Parse one diagram"]
  checkDocs --> markdown["Find the code fences and resolve the links"]
  checkDiagrams --> markdown
  checkComments --> hook["Read the hook input and hand the findings or the context to Claude"]
  checkDocs --> hook
  checkDiagrams --> hook
  loadCommentRules --> languages["Map a file extension to its language"]
  checkComments --> languages
  loadCommentRules --> hook
  sessionContext --> hook
```

| Element | Source |
| --- | --- |
| `hooksJson` | [`hooks.json`](hooks.json) |
| `sessionContext` | [`session-context.mts`](session-context.mts) |
| `loadCommentRules` | [`load-comment-rules.mts`](load-comment-rules.mts) |
| `checkComments` | [`check-comments.mts`](check-comments.mts) |
| `checkDocs` | [`check-docs.mts`](check-docs.mts) |
| `checkDiagrams` | [`check-diagrams.mts`](check-diagrams.mts) |
| `languages` | [`lib/languages.mts`](lib/languages.mts) |
| `markdown` | [`lib/markdown.mts`](lib/markdown.mts) |
| `hook` | [`lib/hook.mts`](lib/hook.mts) |

Every hook informs and never blocks a session or an edit, except `loadCommentRules`. It denies the edit of a source file once, until the transcript of the agent holds the comment rules and the guide of the language, and stays silent when it cannot read the transcript. A hook that has nothing to report prints nothing.

- [markdownlint](https://raw.githubusercontent.com/DavidAnson/markdownlint/main/README.md) and [Mermaid](https://raw.githubusercontent.com/mermaid-js/mermaid/develop/docs/config/usage.md) come from the project that is edited, never from this plugin.
- [Claude Code hooks](https://code.claude.com/docs/en/hooks.md) describes the input a hook reads and the output it writes.

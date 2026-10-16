---
"forge": minor
---

A band above the prompt shows the main session's todo list as `5/8 · <title>`, the title the first item in progress or else the first pending one, and at the right edge of the line the Codex usage left as `Codex 5h 62% · week 81%`. Once either window has less left than the `codex minimum` percent, the usage turns red and reads `Codex 5h 12% · week 81% (below minimum)`. The band follows TodoWrite and the Task tools of the main session, shows `8/8 done` until the user's next prompt, and reads the usage when a list gets open items and after each Codex call. Claude Code offers the todo and task tools by default only on Opus 4.7, Sonnet 4.6, Haiku 4.5 and earlier models, so on any other model the band stays empty unless `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` is set. `codex-model.mts --usage` prints that usage as one JSON line, and without `--min-remaining` the script takes its minimum from the `codex minimum` line of `~/.claude/rules/models.md`.

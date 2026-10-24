---
"forge": minor
---

The band above the prompt now shows the Codex usage left at all times, also with no todo list open. Without a list the terminal line holds `Codex 5h 62% · week 81%` alone at the right edge, and the desktop and mobile row holds the Codex caption alone at its right end. The usage is read when the session starts, on every prompt that is not a meta prompt and after each Codex call, in place of the read when a list got open items. A failed read still hides the usage, so with no list and no usage the band draws nothing. `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` is now needed only for the todo progress.

---
"forge": minor
---

A question now comes with its facts as text. In a test of 16 headless runs the model never wrote the facts and research a decision needs before it called AskUserQuestion, its message held only thinking and the tool call, so the user read a question without its basis. A new PreToolUse hook on `AskUserQuestion` denies the call when the assistant output since the last tool result or user message holds no non-empty text block, and tells Claude to write the facts as text first and ask again. It waits up to 3 seconds for the call to reach the transcript, because Claude Code writes it after the hook has started, and stays silent when the transcript cannot be read.

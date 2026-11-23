---
"forge": minor
---

The findings of the comment, documentation and diagram rules now reach Claude right after each Edit, Write or MultiEdit, old lines of the file included, so it fixes them while the file is open instead of reopening it at the end of the turn. A new PostToolUse hook runs the rule sets of the Stop hook on the one edited file, except the diagrams that link a changed file, and hands the findings back as additional context. It stays silent when there is none. The Stop hook stays as the backstop and now tells Claude to continue the task where it stopped and to end the turn only when the task is done, where it used to say to end the turn after the fixes, which left a task unfinished once.

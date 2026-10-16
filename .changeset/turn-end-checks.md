---
"forge": minor
---

One turn hook replaces the three PostToolUse checks. When a turn or a subagent stops, it checks every file the turn changed, however it changed, whether an Edit, a Write, a shell command, a commit or an amend, with the comment rules, the documentation rules and the diagram rules. A diagram whose table links a changed file is named too, unless the turn changed the diagram's own file. It blocks the stop once with all findings and stays silent on the stop after it. A subagent with its own worktree is checked when it stops. A stop starts no git call and no new file after 25 seconds and names the files and the checkouts it left.

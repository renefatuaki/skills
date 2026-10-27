---
"forge": minor
---

`/setup-models` asks for an effort mode right after the budget. With `fixed`, the default, every subagent spawns with the effort of its line in `~/.claude/rules/models.md`. With `adaptive`, the agent raises or lowers that effort to fit each job. A `~` or `=` after an entry's effort makes that one entry adaptive or fixed. `/engineering <task> effort:adaptive` or `/engineering <task> effort:fixed` sets the mode for one task.

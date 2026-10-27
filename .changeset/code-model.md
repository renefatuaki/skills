---
"forge": minor
---

`/setup-models` asks right after the budget which model the code roles run on, `sonnet`, `opus` or `fable`. The code roles are `feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb` and `swarm workers`, and each keeps its effort. `/engineering <task> model:opus` runs the code roles of one task on that model, and `model:sonnet` or `model:fable` work the same way. After `/engineering `, Claude Code shows the hint `[model:sonnet | model:opus | model:fable]`, and a misspelled model such as `model:opsu` gets a question instead of being ignored.

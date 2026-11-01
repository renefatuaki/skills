---
name: setup-models
description: Configure which models this plugin uses per role and at what reasoning budget. Writes an always-loaded Claude Code rule that overrides the skill defaults. Use for /setup-models, "configure models", "model budget", or changing this plugin's model choices.
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/workflow/engineering/scripts/codex-model.mts *), Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/workflow/engineering/scripts/antigravity-model.mts *)
---

# Setup models

Write `~/.claude/rules/models.md`, a user-level rule that sets this plugin's model and effort per role. Claude Code loads every file in `~/.claude/rules/` into every session, so the roles are in context whenever a skill of this plugin spawns a subagent. `${CLAUDE_PLUGIN_ROOT}/skills/workflow/engineering/references/model-roles.md` says how skills read it.

## Steps

### 1. Check the environment

- The selectable models are `haiku`, `sonnet`, `opus`, and `fable`, plus `inherit` (run the role on the parent session's model), `codex:<model>`, and `antigravity:<model>`. The Codex models are `luna`, `sol`, and `astra`. The Antigravity models are `flash`, `pro`, `argon`, and `carbon`, ascending by strength.
- Run `node ${CLAUDE_PLUGIN_ROOT}/skills/workflow/engineering/scripts/codex-model.mts --min-remaining 0 <model>` for each Codex model, so you can show the full name it runs today, such as `gpt-6-astra` for `astra`. When it fails, show its message, and remind the user to run `/codex:setup` when it says the Codex CLI is not installed.
- Run `node ${CLAUDE_PLUGIN_ROOT}/skills/workflow/engineering/scripts/antigravity-model.mts --min-remaining 0 <model> high` for each of the four Antigravity models, so you can show the slug it runs today, such as `gemini-3.8-flash-high` for `flash`. A note on stderr means the model lists no `high` and the slug carries the nearest effort, so show the note too. When it fails, show its message, and remind the user to run `/antigravity:setup` when it says the Antigravity CLI is not installed or not signed in. A model the CLI does not list, such as `argon` or `carbon` on an account without its plan, shows its message as the result. Its entry would run on the Claude model of the same rank.
- Run `node ${CLAUDE_PLUGIN_ROOT}/skills/workflow/engineering/scripts/antigravity-model.mts --usage`, so you can show the percent left of each Gemini group. When it fails, show its message. A slot then starts without a usage check.

### 2. Load current state

The default role-to-model mapping is the rule shape shown in step 5 below. If `~/.claude/rules/models.md` already exists, read it and treat its `# budget` line, its `effort` line, its role values with their `~` and `=` marks, its `codex minimum` line, and its `antigravity minimum` line as the current choices. Otherwise start from those defaults. A line whose role is not in step 5, such as `how critics`, is from a retired role. Drop it. A legacy Cursor rule at `~/.cursor/rules/pstack-models.mdc` is not read. Mention it if it exists, since its Grok and Cursor slugs do not apply here.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Prefer AskUserQuestion over free text. Offer these four options with these exact labels, and name the current budget when the rule records one. With no rule, say that `large` matches the skill defaults.

- `unlimited — one effort step up`
- `large — defaults`
- `medium — one effort step down`
- `small — two effort steps down`

**(b) Ask for the code model.** Ask which Claude model the code roles run on, per **Code model** in `${CLAUDE_PLUGIN_ROOT}/skills/workflow/engineering/references/model-roles.md`. Prefer AskUserQuestion with the labels `sonnet — defaults`, `opus`, and `fable`. On a re-run, offer first the model the code roles share. When they hold different models, offer first `keep — each code role keeps its model`. A code role whose value is `inherit`, a Codex entry, or an Antigravity entry keeps it.

**(c) Ask for the effort mode.** Ask whether every entry spawns with exactly its effort or the agent adjusts it to the job before each spawn, per **Effort mode** in `${CLAUDE_PLUGIN_ROOT}/skills/workflow/engineering/references/model-roles.md`. Prefer AskUserQuestion with the labels `fixed — every entry runs with its effort` and `adaptive — the agent adjusts the effort per spawn`. Offer the current mode first on a re-run, otherwise `fixed`. Say that step (e) can give a single entry the other mode with a mark.

**(d) Apply the budget.** Start from the defaults, put the model of step (b) on the code roles, and on a re-run keep any other role the user changed by model, list, or `inherit`. With `keep`, the code roles count as other roles. The effort ladder is `max` > `xhigh` > `high` > `medium` > `low`. A budget shifts every `<model>/<effort>` entry, panel entries included, along that ladder from its default effort, and clamps at both ends. So `unlimited` turns `opus/xhigh` into `opus/max` and `sonnet/high` into `sonnet/xhigh`. `small` turns them into `opus/medium` and `sonnet/low`. A `codex:<model>/<effort>` entry shifts the same way but tops out at `xhigh`, so `unlimited` leaves `codex:astra/xhigh` unchanged and `small` makes it `codex:astra/medium`. An `antigravity:<model>/<effort>` entry shifts along the whole ladder like a Claude entry, because the script runs the nearest effort the model lists. `unlimited` turns `antigravity:pro/high` into `antigravity:pro/xhigh` and `small` makes it `antigravity:pro/low`. `inherit` does not change. On a re-run, copy each `~` or `=` mark from the current rule onto the shifted entry. A mark alone is no change, so the budget still shifts that entry's effort.

**(e) Show the roles and confirm.** Show every role with its value and the mode of each entry, such as `bug-fix: opus/high (adaptive)`. An entry has the mode of step (c) unless its mark says otherwise. Also list each line step 2 dropped. Ask whether to accept as-is or change specific roles, offering `haiku`, `sonnet`, `opus`, `fable`, `inherit`, `codex:<model>` with a Codex model from step 1, and `antigravity:<model>` with an Antigravity model from step 1, plus an effort. Also offer a mark for an entry that should run in the other mode, `~` for adaptive and `=` for fixed. Drop a mark that repeats the mode of step (c). A Codex entry always names its model and its effort, as in `codex:astra/xhigh`, so the run never falls back to the model and effort in `~/.codex/config.toml`. An Antigravity entry also always names its model and its effort, as in `antigravity:pro/high`, with an effort on the ladder, so the run never falls back to the model of the user's Antigravity settings. Prefer AskUserQuestion over free text. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, `inherit`, Codex and Antigravity entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena selects one value from it whose model family differs from the parent's when possible. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

**(f) Ask for the Codex minimum and the Antigravity minimum.** Skip the Codex question when no role holds a Codex entry. Otherwise ask how much usage, in percent of the tighter of the 5-hour and the weekly window, a Codex slot needs left to start. Below it, the slot runs on the Claude model of the same rank. Skip the Antigravity question when no role holds an Antigravity entry. Otherwise ask how much usage, in percent of the tightest limit of the Gemini group, an Antigravity slot needs left to start. Say that `/usage` does not count AI credits, so `0%` fits a user whose credits pay past the limit. Prefer AskUserQuestion, and offer `20%` as the default, `10%`, and `30%`, or the current value first on a re-run.

### 4. Validate

Every model is one of `haiku`, `sonnet`, `opus`, `fable`, `inherit`, `codex:<model>`, or `antigravity:<model>`. Every Claude effort, without its mark, is on the ladder. Every Codex entry is `codex:<model>/<effort>`, with a Codex model from step 1 and an effort of `xhigh`, `high`, `medium`, `low`, `minimal`, or `none`. A Codex entry is not allowed outside panel roles and `swarm workers`. Every Antigravity entry is `antigravity:<model>/<effort>`, with an Antigravity model from step 1 and an effort on the ladder. An Antigravity entry is not allowed outside panel roles and `swarm workers`. A `~` or `=` mark may follow only an effort, so `inherit~` and `opus~` fail. The code model is `sonnet`, `opus`, `fable`, or `keep`. The effort mode is `fixed` or `adaptive`. The Codex minimum and the Antigravity minimum are whole percents from 0 to 100. If a value fails, stop and ask again.

### 5. Write the rule

Create `~/.claude/rules/` if needed. Write `~/.claude/rules/models.md` with no frontmatter, so it loads in every session, a `# budget` line with the chosen label, an `effort` line with the chosen mode, one line per role with its marks, a `codex minimum` line when a role holds a Codex entry, and an `antigravity minimum` line when a role holds an Antigravity entry, using the same labels the engineering skill uses. Overwrite the whole file so re-runs stay idempotent. Shape, at the `large` budget:

```
# forge model configuration. Used by skills of the forge plugin when they spawn subagents with the Agent tool.
# One line per role: `<model>/<effort>`, `inherit`, `codex:<model>/<effort>`, or `antigravity:<model>/<effort>`. Panels take a comma-separated list.
# `codex minimum` is the usage a Codex slot needs left to start, in percent of a window.
# `antigravity minimum` is the usage an Antigravity slot needs left to start, in percent of a limit.
# `effort: fixed` spawns every entry with its effort. `effort: adaptive` lets the agent adjust it per spawn.
# A `~` after an effort makes that entry adaptive. A `=` makes it fixed.
# Delete a line to fall back to the skill default. Re-run /setup-models to change it.
# budget: large
effort: fixed
feature, refactoring: sonnet/high
bug-fix: sonnet/high
perf-issue: sonnet/high
hillclimb: sonnet/high
judgment and prose: opus/xhigh
hardest tasks: opus/xhigh
follow-up judge: fable/xhigh
how explorer: sonnet/high
how explainer: opus/xhigh
why investigators: sonnet/high
why synthesizer: opus/xhigh
reflect tooling: sonnet/high
reflect judgment, divergent, synthesizer: opus/xhigh
arena runners: opus/xhigh, codex:astra/xhigh
arena cross-judge pool: opus/xhigh, codex:astra/xhigh
swarm workers: sonnet/high
architect runners: opus/xhigh, codex:astra/xhigh
interrogate reviewers: opus/xhigh, codex:astra/xhigh
codex minimum: 20%
```

### 6. Confirm

Tell the user the rule was written and that it applies to new sessions. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, read `${CLAUDE_PLUGIN_ROOT}/skills/verification/create-verification-skill/SKILL.md` and follow it. On no, move on without pushing.

### 8. Offer a formal verification skill (optional)

Check whether the project already has a formal verification skill (a project skill that runs a model checker, a proof, or another verifier against the code). If not, offer once: "want a formal verification skill, so agents can prove a key property of your code holds in every case in scope, not only the cases tests reach? I can generate one with /create-formal-verification-skill." On yes, read `${CLAUDE_PLUGIN_ROOT}/skills/verification/create-formal-verification-skill/SKILL.md` and follow it. On no, move on without pushing.

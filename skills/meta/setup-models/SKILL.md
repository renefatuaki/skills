---
name: setup-models
description: Configure which models this plugin uses per role and at what reasoning budget. Writes an always-loaded Claude Code rule that overrides the skill defaults. Use for /setup-models, "configure models", "model budget", or changing this plugin's model choices.
---

# Setup models

Write `~/.claude/rules/models.md`, a user-level rule that sets this plugin's model and effort per role. Claude Code loads every file in `~/.claude/rules/` into every session, so the roles are in context whenever a skill of this plugin spawns a subagent. `${CLAUDE_PLUGIN_ROOT}/skills/workflow/engineering/references/model-roles.md` says how skills read it.

## Steps

### 1. Check the environment

- The selectable models are `opus`, `sonnet`, `haiku`, and `fable`, plus `inherit` (run the role on the parent session's model) and `codex`.
- Read `model` and `model_reasoning_effort` from `~/.codex/config.toml`, so you can show what a bare `codex` entry runs. If the file is missing, remind the user to run `/codex:setup`.

### 2. Load current state

The default role-to-model mapping is the rule shape shown in step 5 below. If `~/.claude/rules/models.md` already exists, read it and treat its `# budget` line and its role values as the current choices. Otherwise start from those defaults. A line whose role is not in step 5, such as `how critics`, is from a retired role. Drop it. A legacy Cursor rule at `~/.cursor/rules/pstack-models.mdc` is not read. Mention it if it exists, since its Grok and Cursor slugs do not apply here.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Prefer AskUserQuestion over free text. Offer these four options with these exact labels, and name the current budget when the rule records one. With no rule, say that `large` matches the skill defaults.

- `unlimited — one effort step up`
- `large — defaults`
- `medium — one effort step down`
- `small — two effort steps down`

**(b) Apply it.** Start from the defaults, and on a re-run keep any role the user changed by model, list, or `inherit`. The effort ladder is `max` > `xhigh` > `high` > `medium` > `low`. A budget shifts every `<model>/<effort>` entry, panel entries included, along that ladder from its default effort, and clamps at both ends. So `unlimited` turns `opus/xhigh` into `opus/max` and `sonnet/high` into `sonnet/xhigh`. `small` turns them into `opus/medium` and `sonnet/low`. A `codex/<effort>` or `codex:<model>/<effort>` entry shifts the same way but tops out at `xhigh`, so `unlimited` leaves `codex/xhigh` unchanged and `small` makes it `codex/medium`. `inherit` and a bare `codex` do not change.

**(c) Show the roles and confirm.** Show every role with its value. Also list each line step 2 dropped. Ask whether to accept as-is or change specific roles, offering `opus`, `sonnet`, `haiku`, `fable`, `inherit`, and `codex` plus an effort. A Codex entry may also name a Codex model, as in `codex:gpt-6-astra/xhigh`. A bare `codex` uses the model and effort step 1 read from `~/.codex/config.toml`. Show them. Prefer AskUserQuestion over free text. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, `inherit` and `codex` entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena selects one value from it whose model family differs from the parent's when possible. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Every model is one of `opus`, `sonnet`, `haiku`, `fable`, `inherit`, `codex`, or `codex:<model>`. Every Claude effort is on the ladder. Every Codex effort is `xhigh`, `high`, `medium`, `low`, `minimal`, or `none`. `codex` is not allowed outside panel roles and `swarm workers`. If a value fails, stop and ask again.

### 5. Write the rule

Create `~/.claude/rules/` if needed. Write `~/.claude/rules/models.md` with no frontmatter, so it loads in every session, a `# budget` line with the chosen label, and one line per role, using the same labels the engineering skill uses. Overwrite the whole file so re-runs stay idempotent. Shape, at the `large` budget:

```
# forge model configuration. Used by skills of the forge plugin when they spawn subagents with the Agent tool.
# One line per role: `<model>/<effort>`, `inherit`, or `codex[:<model>][/<effort>]`. Panels take a comma-separated list.
# Delete a line to fall back to the skill default. Re-run /setup-models to change it.
# budget: large
feature, refactoring: sonnet/high
bug-fix: sonnet/high
perf-issue: sonnet/high
hillclimb: sonnet/high
judgment and prose: opus/xhigh
hardest tasks: opus/xhigh
how explorer: sonnet/high
how explainer: opus/xhigh
why investigators: sonnet/high
why synthesizer: opus/xhigh
reflect tooling: sonnet/high
reflect judgment, divergent, synthesizer: opus/xhigh
arena runners: opus/xhigh, codex/xhigh
arena cross-judge pool: opus/xhigh, codex/xhigh
swarm workers: sonnet/high
architect runners: opus/xhigh, codex/xhigh
interrogate reviewers: opus/xhigh, codex/xhigh
```

### 6. Confirm

Tell the user the rule was written and that it applies to new sessions. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, read `${CLAUDE_PLUGIN_ROOT}/skills/verification/create-verification-skill/SKILL.md` and follow it. On no, move on without pushing.

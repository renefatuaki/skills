# Model roles

Every skill of this plugin that spawns a subagent names a **role** and a **default**. This file says how to turn a role into `Agent` tool parameters. Skills point here instead of repeating it.

## Where the configuration lives

`/setup-models` writes `~/.claude/rules/models.md`. Claude Code loads that rule into every session, so its lines are already in your context when it exists. One line per role:

```
how explorer: sonnet/high
interrogate reviewers: opus/xhigh, codex:astra/xhigh
```

The line `codex minimum: <percent>%`, such as `codex minimum: 20%`, is no role. It sets how much usage a Codex slot needs left, and **Codex slots** reads it. The line `antigravity minimum: <percent>%`, such as `antigravity minimum: 20%`, is no role either. It sets how much usage an Antigravity slot needs left, and **Antigravity slots** reads it. The line `effort: fixed` or `effort: adaptive` is no role either. **Effort mode** reads it.

A missing file or a missing line means the role uses the default the skill names. Lines for roles no skill names are retired. Ignore them.

## Values

| Value | `Agent` parameters |
|---|---|
| `<model>/<effort>`, such as `opus/xhigh` | `model: "<model>"`, `effort: "<effort>"`, adjusted per **Effort mode** when the entry is adaptive |
| `<model>` alone | `model: "<model>"`, no `effort` |
| `inherit` | omit `model` and `effort`. This plugin's agents and `general-purpose` carry no model default, so the subagent runs on the parent session's model. |
| `codex:<model>/<effort>`, such as `codex:astra/xhigh` | a Codex slot. Follow **Codex slots** below, with the effort adjusted per **Effort mode** when the entry is adaptive. |
| `antigravity:<model>/<effort>`, such as `antigravity:pro/high` | an Antigravity slot. Follow **Antigravity slots** below, with the effort adjusted per **Effort mode** when the entry is adaptive. |

Models are `haiku`, `sonnet`, `opus`, and `fable`. Codex models are `luna`, `sol`, and `astra`. Efforts, strongest first, are `max`, `xhigh`, `high`, `medium`, `low`. A Codex slot takes `xhigh`, `high`, `medium`, `low`, `minimal`, or `none`, so a Codex `max` runs as `xhigh`. A Codex entry always names its model and its effort. The Codex CLI gives each model a full name with its version, such as `gpt-6-astra`, and **Codex slots** resolves it. Antigravity models are `flash`, `pro`, `argon`, and `carbon`, ascending by strength. An Antigravity entry takes every effort of the ladder. The Antigravity CLI lists each Gemini model as slugs with its version and effort, such as `gemini-3.8-flash-high`, and a model lists only some efforts, so **Antigravity slots** resolves the nearest one. An Antigravity entry always names its model and its effort. If the `Agent` tool rejects an effort for a model, use the strongest effort it accepts and say so. If it rejects a model, use the skill's default and say so.

A panel role (arena runners, arena cross-judge pool, architect runners, interrogate reviewers) holds a comma-separated list. One subagent runs per entry, `inherit`, Codex and Antigravity entries included, so the list length sets the panel size.

## Effort mode

The line `effort: fixed` or `effort: adaptive` sets the mode of every entry. Without the line the mode is `fixed`. An entry whose effort ends in `~`, such as `sonnet/high~`, is adaptive. An entry whose effort ends in `=`, such as `opus/xhigh=`, is fixed. In a panel each entry carries its own mark. Strip the mark before the effort reaches the `Agent` tool or the `--effort` flag of a Codex or an Antigravity slot.

A task of the engineering skill whose prompt holds `effort:adaptive` or `effort:fixed` uses that mode in place of the line, as step 5 of that skill's `SKILL.md` says. Name that mode in every delegate's brief, so the delegate's own spawns use it. A mark beats the task's mode, and the task's mode beats the line.

A fixed entry spawns with exactly its effort.

**Match the model to the job.** This applies to an adaptive entry. Before each spawn, start from the role's line or default and pick the effort the job needs. The `/setup-models` budget sets each role's starting effort. Raise it one step, up to `max`, for the hardest or subtlest work. Lower it one step for judgment and two or more steps for routine work, down to `low`. Verification is the exception and stays on the `swarm workers` model and effort. Change only the effort, and keep the model the role names, so a diverse panel stays diverse. A Codex entry uses the Codex efforts from `xhigh` down to `low`, and its fallback keeps the adjusted effort. An Antigravity entry uses the whole ladder like a Claude entry, because the resolver runs the nearest effort the model lists, and its fallback keeps the adjusted effort. An entry without an effort and an `inherit` entry get no effort in either mode. If the `Agent` tool rejects the adjusted effort, do not try another adjusted effort. Use the role's line or default and say so.

## Code model

The code roles are `feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb`, and `swarm workers`. `/setup-models` sets their model with one question. A task of the engineering skill whose prompt holds `model:sonnet`, `model:opus`, or `model:fable` runs every code role on that model in place of the model of its line or default, as step 5 of that skill's `SKILL.md` says. The effort stays that of the line or default, its mark included. An `inherit` entry, a Codex entry, an Antigravity entry, and a swarm arm that names its own model keep their value. Name that model in every delegate's brief, so the delegate's own spawns use it. Every other role, `hardest tasks` included, keeps its model.

## Model families

Panels and cross-judges reason about families. `haiku`, `sonnet`, `opus`, `fable`, and `inherit` are the `claude` family. Every Codex entry is the `codex` family. Every Antigravity entry is the `antigravity` family. A panel gets its diversity from mixing families. Two Claude models at different efforts still count as one family.

## Codex slots

A Codex entry runs the slot through OpenAI Codex using the `codex` plugin's forwarding agent.

1. Resolve the model. `node ${CLAUDE_PLUGIN_ROOT}/skills/workflow/engineering/scripts/codex-model.mts --min-remaining <percent> <model>`, with Node 24 or newer, which runs TypeScript directly, prints the newest full name the Codex CLI lists, such as `gpt-6-astra` for `astra`. The percent is the one of the `codex minimum` line, and 20 without the line. The script fails when the account reached its usage limit or has less than that percent left of its 5-hour or weekly window, unless credits pay for the run, so no slot starts a run the limit could cut off. When it fails, the slot falls back as step 6 says. A line on stderr about a failed refresh means the name comes from the catalog bundled with the Codex CLI instead of the user's account, so name it in the skill's report.
2. Spawn `Agent` with `subagent_type: "codex:codex-rescue"`. Leave the `Agent` `model` and `effort` unset. They would only steer the forwarder, not Codex.
3. Start the prompt with `--wait`, so the forwarder blocks until Codex finishes and returns the result instead of a background job handle. Follow it with the entry's `--effort <effort>` and the full name of step 1 as `--model <name>`, for example `--wait --effort xhigh --model gpt-6-astra`. The forwarder passes these flags to Codex and strips them from the task text, so Codex never falls back to the model and `model_reasoning_effort` of the user's `~/.codex/config.toml`.
4. For review, judging, or design work, say in the first sentence that the run is read-only and that Codex must not modify files. The forwarder then leaves out `--write`. Only a slot that must produce code in its own worktree (an arena or architect runner) asks for a write-capable run, and that run must name the worktree path and branch it owns.
5. Give Codex the full brief. It does not see this conversation. Include file pointers, the base SHA or branch, and the exact output format the skill expects.
6. **Fallback.** When Codex cannot do the work, the slot runs on the Claude model of the same rank instead, `haiku` for `luna`, `sonnet` for `sol`, and `opus` for `astra`. It keeps the entry's effort, except that `minimal` and `none` become `low`. Say in the skill's report that the slot fell back and why. Fall back in these three cases.
   - **The check before the run fails.** Step 1 found no such model in the Codex CLI, or the account has less usage left than the minimum. The slot then never starts Codex.
   - **Codex fails.** The result is empty or an error message, such as a reached usage limit, a missing sign-in (`/codex:setup`), a timeout, or a sandbox denial.
   - **Codex stops early.** The result is not the output the brief asked for, such as a job handle, a status line, or a single sentence like "I'll look at the tests first". A run that hits the usage limit halfway returns its last interim message, which looks like that.

   Two rules apply before the fallback runs.
   - A slot that may write files first undoes what Codex changed, so the Claude model starts from the same state Codex did. Run `git -C <worktree> reset --hard <base>` and `git -C <worktree> clean -fd` in the slot's own worktree.
   - Once one slot hit the usage limit, the other Codex slots of the same run skip Codex and go straight to their Claude model, because their runs would fail the same way.

The fallback keeps the panel the same size and each slot's rank. It does not keep it diverse, so say that the panel ran single-family.

## Antigravity slots

An Antigravity entry runs the slot through Google Antigravity using the `antigravity` plugin's forwarding agent.

1. Resolve the slug. `node ${CLAUDE_PLUGIN_ROOT}/skills/workflow/engineering/scripts/antigravity-model.mts --min-remaining <percent> <model> <effort>`, with Node 24 or newer, which runs TypeScript directly, prints the slug the Antigravity CLI lists, such as `gemini-4-argon-high` for `argon` at `high`. The percent is the one of the `antigravity minimum` line, and 20 without the line.
   - **The slug.** `agy models` lists slugs of the form `gemini-<version>-<model>-<effort>`. Every listed slug ends in its effort. The script takes the newest version of the model, then the exact effort, else the nearest effort that version lists on the ladder `low`, `medium`, `high`, `xhigh`, `max`, a tie going to the lower one. `argon` lists `high` and `medium`, so `argon/low` runs `gemini-4-argon-medium` and `argon/max` runs `gemini-4-argon-high`. When the slug differs from the entry's effort, the script prints a note on stderr. Name it in the skill's report.
   - **The usage.** The script reads `agy -p "/usage" --output-format json` and takes the usage group whose description lists `Gemini <Model>`, such as `Gemini Argon`, else every group whose name starts with `Gemini`. It fails when the tightest limit of those groups has less left than the percent, and the message names the window and the reset time. When `/usage` fails or lists no Gemini group, it prints the slug anyway, with a note on stderr. Name that note in the skill's report. `/usage` does not report AI credits, which can pay for a run past the limit, so a user who pays with credits sets the line to `0%`.

   When the script fails, the slot falls back as step 6 says.
2. Spawn `Agent` with `subagent_type: "antigravity:antigravity-rescue"`. Leave the `Agent` `model` and `effort` unset. They would only steer the forwarder, not Antigravity.
3. Start the prompt with `--wait`, so the forwarder blocks until Antigravity finishes and returns the result instead of a background job handle. Follow it with the slug of step 1 as `--model <slug>`, for example `--wait --model gemini-4-argon-high`. The slug carries the effort, so the prompt names no `--effort`. The forwarder passes the flag to Antigravity and strips it from the task text, so Antigravity never falls back to the model of the user's Antigravity settings.
4. For review, judging, or design work, say in the first sentence that the run is read-only and that Antigravity must not modify files. The forwarder then leaves out `--write`. `agy` then runs in its default permission mode, which denies writes and shell commands, and the run fails with `Antigravity changed files: <paths>` when a file of the git work tree changed anyway. Only a slot that must produce code in its own worktree (an arena or architect runner) asks for a write-capable run, and that run must name the worktree path and branch it owns. A write-capable run edits files and runs shell commands in the terminal sandbox of `agy`.
5. Give Antigravity the full brief. It does not see this conversation. Include file pointers, the base SHA or branch, and the exact output format the skill expects.
6. **Fallback.** When Antigravity cannot do the work, the slot runs on the Claude model of the same rank instead, `sonnet` for `flash` and `opus` for `pro`, `argon`, and `carbon`. It keeps the entry's effort. Say in the skill's report that the slot fell back and why. Fall back in these three cases.
   - **The check before the run fails.** Step 1 found no slug of the model, because the account may lack the plan that includes it, or the account has less usage left than the minimum. The slot then never starts Antigravity.
   - **Antigravity fails.** The result is empty or an error message, such as a missing sign-in (`/antigravity:setup`), a timeout, an `agy` error, or `Antigravity changed files:`.
   - **Antigravity stops early.** The result is not the output the brief asked for, such as a job handle, a status line, or a single sentence like "I'll look at the tests first".

   Three rules apply before the fallback runs.
   - A slot that may write files first undoes what Antigravity changed, so the Claude model starts from the same state Antigravity did. Run `git -C <worktree> reset --hard <base>` and `git -C <worktree> clean -fd` in the slot's own worktree.
   - Once one slot hit the usage limit, the other Antigravity slots of the same run skip Antigravity and go straight to their Claude model, because their runs would fail the same way.
   - A read-only slot that failed with `Antigravity changed files:` leaves the files as they are, because the run cannot tell what Antigravity wrote from the work of the user. Name the paths in the skill's report, so the user reviews them.

The fallback keeps the panel the same size and each slot's rank. It does not keep it diverse, so say that the panel ran single-family.

## Isolation

A subagent that writes code in parallel with other writers gets `isolation: "worktree"`. Claude Code creates its worktree from the repository's default branch. Its brief therefore names the branch or SHA to check out first, and it confirms `git rev-parse HEAD` before working. Read-only subagents need no isolation.

# Model roles

Every skill of this plugin that spawns a subagent names a **role** and a **default**. This file says how to turn a role into `Agent` tool parameters. Skills point here instead of repeating it.

## Where the configuration lives

`/setup-models` writes `~/.claude/rules/models.md`. Claude Code loads that rule into every session, so its lines are already in your context when it exists. One line per role:

```
how explorer: sonnet/high
interrogate reviewers: opus/xhigh, codex/xhigh
```

A missing file or a missing line means the role uses the default the skill names. Lines for roles no skill names are retired. Ignore them.

## Values

| Value | `Agent` parameters |
|---|---|
| `<model>/<effort>`, such as `opus/xhigh` | `model: "<model>"`, `effort: "<effort>"` |
| `<model>` alone | `model: "<model>"`, no `effort` |
| `inherit` | omit `model` and `effort`. This plugin's agents and `general-purpose` carry no model default, so the subagent runs on the parent session's model. |
| `codex`, `codex/<effort>`, `codex:<model>`, `codex:<model>/<effort>`, such as `codex/xhigh` or `codex:gpt-6-astra/high` | a Codex slot. Follow **Codex slots** below. |

Models are `opus`, `sonnet`, `haiku`, and `fable`. Efforts, strongest first, are `max`, `xhigh`, `high`, `medium`, `low`. A Codex slot takes `xhigh`, `high`, `medium`, `low`, `minimal`, or `none`, so a Codex `max` runs as `xhigh`. A Codex model is any name the Codex CLI accepts, such as `gpt-6-astra`. If the `Agent` tool rejects an effort for a model, use the strongest effort it accepts and say so. If it rejects a model, use the skill's default and say so.

A panel role (arena runners, arena cross-judge pool, architect runners, interrogate reviewers) holds a comma-separated list. One subagent runs per entry, `inherit` and `codex` entries included, so the list length sets the panel size.

## Model families

Panels and cross-judges reason about families. `opus`, `sonnet`, `haiku`, `fable`, and `inherit` are the `claude` family. Every `codex` form is the `codex` family. A panel gets its diversity from mixing families. Two Claude models at different efforts still count as one family.

## Codex slots

A `codex` entry runs the slot through OpenAI Codex using the `codex` plugin's forwarding agent.

1. Spawn `Agent` with `subagent_type: "codex:codex-rescue"`. Leave the `Agent` `model` and `effort` unset. They would only steer the forwarder, not Codex.
2. Start the prompt with `--wait`, so the forwarder blocks until Codex finishes and returns the result instead of a background job handle. Follow it with `--effort <effort>` when the entry names an effort and `--model <model>` when it names a model, for example `--wait --effort xhigh --model gpt-6-astra`. The forwarder passes these flags to Codex and strips them from the task text. A bare `codex` entry adds neither, so Codex uses the model and `model_reasoning_effort` from the user's `~/.codex/config.toml`, which may be a low effort.
3. For review, judging, or design work, say in the first sentence that the run is read-only and that Codex must not modify files. The forwarder then leaves out `--write`. Only a slot that must produce code in its own worktree (an arena or architect runner) asks for a write-capable run, and that run must name the worktree path and branch it owns.
4. Give Codex the full brief. It does not see this conversation. Include file pointers, the base SHA or branch, and the exact output format the skill expects.
5. **Fallback.** The slot falls back to `model: "sonnet"` with the entry's effort (`minimal` and `none` become `low`), or `high` when none is set, when any of these hold. Name the reason in the skill's report.
   - The result is empty or reports an error, such as Codex not being signed in (`/codex:setup`), a timeout, or a sandbox denial.
   - The result is a job handle or a status line instead of the requested output.

The fallback keeps the panel the same size. It does not keep it diverse, so say that the panel ran single-family.

## Isolation

A subagent that writes code in parallel with other writers gets `isolation: "worktree"`. Claude Code creates its worktree from the repository's default branch. Its brief therefore names the branch or SHA to check out first, and it confirms `git rev-parse HEAD` before working. Read-only subagents need no isolation.

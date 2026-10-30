---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/workflow/engineering/scripts/codex-model.mts *)
disable-model-invocation: true
argument-hint: "[task] [first pass | rank all | best-of]"
---

# Swarm

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Pick the worker model from the `swarm workers` line in `~/.claude/rules/models.md`. Resolve it per `${CLAUDE_PLUGIN_ROOT}/skills/workflow/engineering/references/model-roles.md`. If the rule or that line is missing, use `sonnet/high`. For a model race, name each arm's model up front. A Codex arm, such as `codex:astra/high`, is a Codex slot. An Antigravity arm, such as `antigravity:pro/high`, is a read-only Antigravity slot, so it fits only a worker that does not write. A worker that writes runs on the Claude model of the same rank.
4. Give each worker its own writable output when it writes, and its own ports, `/tmp` subdirectory, and test data when it runs the app, since workers share this machine. When workers verify or measure commits, each brief names the exact SHAs. A measurement brief also names the method (sample count, what one sample is, order). The worker records both in its result.

## Phase B: Fan out

Spawn all N workers in one message with `subagent_type: "general-purpose"`, `run_in_background: true`, and the step 3 model and effort. A worker that checks out code, builds, or writes in the repository also gets `isolation: "worktree"`. Read-only workers that only inspect the current checkout skip isolation. All N run on this machine, so a large N shares its CPU, memory, ports, and API rate limits. Batch the spawns when the machine or the limits cannot take N at once.

A worktree starts from the repository's default branch. When a worker must start from another branch or SHA, its brief names it, and the worker checks it out and confirms `git rev-parse HEAD` before doing anything else.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect reports `ISSUES` and lists every issue it can prove, not only the first.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the terminal results. Drop a result that does not record the SHAs and method its brief names, and respawn that worker once. After a second miss, record a gap. A gap does not count as a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

## Phase D: Report

Return one consolidated in-chat report with a result table, issue one-liners, gaps or dropouts, and the race rule when used.

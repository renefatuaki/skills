# Set up forge

In this page you install the plugin, pick which models forge uses, and run your first task. Setup is one command plus a short conversation.

## Install the plugin

In a Claude Code session, run:

```text
/plugin install forge --marketplace renefatuaki/skills
```

Claude Code confirms the plugin is installed.

## Pick your models

Run:

```text
/setup-models
```

[`/setup-models`](../../skills/meta/setup-models/SKILL.md) shows the models you can pick, asks for a reasoning budget, shows you each role (code delegates, judgment, the review panels), and asks what you want. Answer the questions. It writes `~/.claude/rules/models.md`, a small rule every skill of this plugin reads.

The defaults are the same as the `large` budget. `unlimited` lifts each model one effort step, up to `max`. Opus goes to `max`. Codex tops out at `xhigh`, so it stays there. `medium` and `small` lower the reasoning and spend fewer tokens.

`/setup-models` then asks which model the code roles run on. They are `feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb` and `swarm workers`. `sonnet` is the default, and `opus` or `fable` spend more for harder code. Each role keeps its effort. To pick the model for one `/engineering` task, add it to the prompt, such as `/engineering #42 model:opus`.

`/setup-models` also asks for an effort mode. With `fixed`, the default, every subagent spawns with exactly the effort of its role. With `adaptive`, that effort is a starting point. The agent goes one step up for the hardest work, one step down for judgment, and two or more steps down for routine work. To make one entry adaptive, put `~` after its effort, such as `how explorer: sonnet/high~`. To make it fixed, put `=` there. In a panel, each entry takes its own mark. To set the mode for one `/engineering` task, add it to the prompt, such as `/engineering #42 effort:adaptive`. A marked entry keeps the mode of its mark.

You only override what you care about. A role with no line in the rule keeps the skill's default. To restore a default, delete that role's line. A rerun of `/setup-models` keeps any role whose model differs from the default. When a default changes, a rule written before the change still pins the old default, so delete those role lines, or delete the file, then run `/setup-models` again.

Set a role to `inherit` and the subagent runs on your session's own model. For a panel role the value is a list, and one subagent runs per entry, so the list length sets the panel size. Setup also configures `swarm workers`, the default model for every `/swarm` worker unless a race names a model for each arm.

Antigravity is an opt-in third family next to Claude and Codex. It runs through the `antigravity` plugin of the same marketplace, the way Codex runs through the `codex` plugin. Install it and check the `agy` CLI.

```text
/plugin install antigravity --marketplace renefatuaki/skills
/antigravity:setup
```

With the Claude Code sandbox on, take the companion of the plugin out of the sandbox, as the plugin's [README](../../plugins/antigravity/README.md#sandbox) shows. The sandbox denies writes under `~/.claude`, where the companion keeps its jobs, so without the entry every Antigravity slot falls back to Claude.

Then set a role to `antigravity:<model>/<effort>`, such as `antigravity:pro/high`, or pick it in `/setup-models`. The models are `flash`, `pro`, `argon`, and `carbon`, ascending by strength. `flash`, `pro`, and `argon` run as Gemini Flash, Gemini Pro, and Gemini Argon. No official list names `carbon` yet, so most accounts list no such model. The efforts are the same as for Claude. A Gemini model offers only some of them, so a slot runs the nearest effort its model offers and says so. `argon` at `low` runs `medium`. An Antigravity entry is allowed wherever a Codex entry is, the runners of `/arena` and `/architect` included. To hand one task to Antigravity yourself, run `/antigravity:rescue`, and its README lists the other commands.

Your Google plan decides which models the `agy` CLI lists for you, as [Antigravity models](https://antigravity.google/docs/models.md) says. A model your plan does not include runs on the Claude model of the same rank instead.

| Model | Free and Google AI Plus | Google AI Pro | Google AI Ultra | Enterprise |
| --- | --- | --- | --- | --- |
| `flash` (Gemini 3.8 Flash) | yes | yes | yes | yes |
| `argon` (Gemini 4 Argon) | no | yes, paid or on trial with an eligible premium device | yes | yes |
| `pro` (Gemini 3.1 Pro) | no | no | no | yes |

Before a run, a slot reads your quota with `/usage` of `agy`. When less than the minimum is left, the slot runs on the Claude model instead. `/setup-models` asks for the minimum and writes it as `antigravity minimum: <percent>%`. Without the line the minimum is 20%. Your AI credits can pay for a run past the quota, and `/usage` does not report them, so set `0%` if you want the slot to run anyway.

A review or judging slot runs read-only. `agy` then keeps its default permission mode, which denies writes and shell commands. If your Antigravity settings allow edits anyway, the run fails inside a git work tree and names the files that changed, so the slot falls back and the report lists them. A runner of `/arena` or `/architect` runs write-capable in its own worktree. It edits files and runs shell commands in the terminal sandbox of `agy`.

Sources are [Headless mode](https://antigravity.google/docs/cli/headless.md), [Modes](https://antigravity.google/docs/cli/modes.md), [Model quotas](https://antigravity.google/docs/cli/commands/usage.md), and [Effort](https://antigravity.google/docs/cli/commands/effort.md).

## Accept the verification offers, or don't

At the end of setup, `/setup-models` looks for a way to prove app behavior in your project, either a `verify-*` skill or an existing harness. If it finds neither, it offers once to generate one with [`/create-verification-skill`](../../skills/verification/create-verification-skill/SKILL.md).

Say yes and it writes `.claude/skills/verify-<app>/`, a project-local skill that teaches agents to drive your app the way a user does. It proves the skill works once before handing it over. Say no and setup moves on. You can run `/create-verification-skill` yourself any time. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers it in depth.

If you're new to forge, say yes. An agent that can check its own work keeps going until the check passes. An agent that can't hands every result back to you to check by hand. Of everything in this guide, the verification skill pays off the most.

Then setup offers once to generate a formal verification skill with [`/create-formal-verification-skill`](../../skills/verification/create-formal-verification-skill/SKILL.md), unless the project already has one. Tests check the cases someone thought to write. A formal verification skill checks one key property of your code, such as "a job never runs twice at once", in every case within a stated scope. Say yes when your code has concurrency, retries, a state machine, or a parser, where a bug is costly and tests rarely reach the case that breaks. Otherwise say no, and run it later if that changes. [Verify and ship](./06-verify-and-ship.md#prove-a-property-with-a-formal-verification-skill) covers it.

After setup, start a new session. The model rule applies to new sessions.

## Keep the cost in check

forge spends extra tokens on subagents and review panels. That's the price of the rigor. To spend fewer:

- Rerun `/setup-models` and pick a smaller reasoning budget or cheaper models. A strong model in the main session with cheaper, faster models in the code roles is a good split.
- Set a role to `inherit` so it runs on the session's own model.
- Shorten a panel list. Each entry runs one subagent.
- Save `/engineering` for work that needs rigor. A small, obvious edit doesn't.

## Run your first task

Pick something real but small, and describe it the way you'd describe it to a colleague:

```text
/engineering add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch the todo list. Its first items are the matched playbook's steps copied in, the Feature playbook for this prompt. If `/engineering` skips a step, the step stays in the list with `skip: <reason>`, so you can see what it chose not to do.

From here you can type normal follow-ups. Once invoked, `/engineering` stays on for the rest of the session, and every new task runs the playbook that matches it. A casual turn, or one you opt out of, skips it.

Next: [Route work through `/engineering`](./02-engineering.md).

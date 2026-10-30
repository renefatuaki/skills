# skills

Claude Code skills for clean code, engineering workflows and project management, packaged as a plugin.

## Install

Install the plugin from this repository's marketplace, in one step on Claude Code 2.1.275 or later.

```text
/plugin install forge --marketplace renefatuaki/skills
```

## Requirements

- Node 24 or newer, because the hooks and the bundled scripts are TypeScript that Node runs directly.
- pnpm in the version that [package.json](package.json) names.

Install the dependencies, which also wires the git hooks.

```sh
pnpm install
```

## Working on the repository

| Command | What it does |
| --- | --- |
| `pnpm run format` | formats every file with oxfmt |
| `pnpm run format:check` | reports unformatted files |
| `pnpm run lint` | runs oxlint |
| `pnpm run lint:fix` | runs oxlint and applies its fixes |
| `pnpm run typecheck` | checks the `.mts` files with tsc |
| `pnpm test` | runs the tests of the comment rules, the documentation rules, the diagram rules, the session hook, the Codex model script, the Antigravity script, the turn hook and the app token script |
| `pnpm run check-upstream` | lists what changed upstream since the base commit of every file in [UPSTREAM.md](UPSTREAM.md), with `gh` logged in |

- The pre-commit hook judges the staged files with oxfmt and oxlint.
- The commit-msg hook runs commitlint.
- The [Check workflow](.github/workflows/check.yml) runs the checks on every pull request and before every release.
- Each change ships with a changeset under `.changeset/`.
- The hooks under `hooks/` run when a session starts and while a turn runs. [hooks/README.md](hooks/README.md) shows how they work together.

The clean-code skill carries a formatter and linter configuration per language under `skills/clean-code/clean-code/formatting/`. Which rule each tool covers, and where the agent fills the gap, is listed in [coverage.md](skills/clean-code/clean-code/formatting/coverage.md).

## The engineering skill

The engineering skill works every development task through the playbook that matches it. It reads the task, opens that playbook and follows its steps, from a question about the code to a GitHub issue worked to a pull request ready for review.

- [pstack](https://github.com/cursor/plugins/tree/main/pstack) is the source the engineering skill adapts to Claude Code.
- The [guide](docs/guide/README.md) explains the workflow in depth, from the first prompt to a pull request ready for review.
- [UPSTREAM.md](UPSTREAM.md) names every copied file and what changed in it.

| Entry point | What it does |
| --- | --- |
| `/engineering` | turns engineering on for the rest of the session, so every task runs the playbook that matches it |
| `/engineering #<issue>` | works the GitHub issue through the Ticket playbook, from the board to a pull request ready for review |

The today-issues skill starts each ticket of its plan with `/engineering <issue-url>`, which takes the same route.

| Playbook | Runs for |
| --- | --- |
| [Ticket](skills/workflow/engineering/playbooks/ticket.md) | a GitHub issue, worked in its own worktree to a pull request ready for review |
| [Feature](skills/workflow/engineering/playbooks/feature.md) | new or changed behaviour |
| [Bug fix](skills/workflow/engineering/playbooks/bug-fix.md) | a reported defect to reproduce, find the root cause of and fix |
| [Refactoring](skills/workflow/engineering/playbooks/refactoring.md) | a change to the structure that keeps the behaviour |
| [Investigation](skills/workflow/engineering/playbooks/investigation.md) | a read-only question about the code |
| [Perf issue](skills/workflow/engineering/playbooks/perf-issue.md) | a measured slowness, improved against a baseline |
| [Hillclimb](skills/workflow/engineering/playbooks/hillclimb.md) | one metric, improved attempt by attempt until it reaches a target |
| [Runtime forensics](skills/workflow/engineering/playbooks/runtime-forensics.md) | a live symptom such as a leak, a CPU spin or a glitch, diagnosed from instrumentation without a fix |
| [Trace forensics](skills/workflow/engineering/playbooks/trace-forensics.md) | a captured profile, trace, spindump or heap snapshot, diagnosed after the fact without a fix |
| [Prototype](skills/workflow/engineering/playbooks/prototype.md) | a throwaway sketch that settles a design decision |
| [Visual parity](skills/workflow/engineering/playbooks/visual-parity.md) | a UI that must match a baseline pixel for pixel, checked by image diff |
| [Authoring a skill](skills/workflow/engineering/playbooks/authoring-a-skill.md) | a `SKILL.md` written or edited |
| [Eval](skills/workflow/engineering/playbooks/eval.md) | a skill or prompt change, tested on blinded agents before it is promoted |
| [Autonomous run](skills/workflow/engineering/playbooks/autonomous-run.md) | a long task driven to a checkable exit condition without stopping |
| [Session pickup](skills/workflow/engineering/playbooks/session-pickup.md) | the unfinished work of an earlier session, resumed from its transcript or branch |
| [Worktree cleanup](skills/workflow/engineering/playbooks/worktree-cleanup.md) | disk space, reclaimed from merged worktrees and stale simulators |
| [Opening a PR](skills/workflow/engineering/playbooks/pull-request.md) | the end of every other playbook, the diff cleaned, committed and opened ready for review |

A large or cross-cutting task, or one that no playbook fits, goes to the figure-it-out skill.

The skills of the plugin live in one folder per category.

| Category | Skills | What they do |
| --- | --- | --- |
| [`workflow`](skills/workflow) | engineering, how, why, architect, arena, interrogate, swarm, blast-radius, figure-it-out, tdd, show-me-your-work | the frame and the tools a playbook runs |
| [`principles`](skills/principles) | 24 principles, such as prove-it-works | the rules a playbook names for each decision |
| [`verification`](skills/verification) | control-ui, control-cli, verify-this, create-verification-skill, maintain-verification-skill, create-formal-verification-skill, maintain-formal-verification-skill, benchmark-checklist | drive the running application and check a claim |
| [`meta`](skills/meta) | reflect, correct, recall, automate-me, teach, bro, sharpen, in-your-own-words, setup-models | learn from past sessions, explain, sharpen a prompt, and configure the models |
| [`docs`](skills/docs) | diagrams, project-docs, unslop, technical-writing | write documentation and prose |
| [`clean-code`](skills/clean-code) | clean-code, code-comments, typescript-best-practices | write readable code |
| [`git`](skills/git) | commit, tidy-history | write commits and tidy the history of a branch |
| [`github`](skills/github) | issue, project, pull-request, pull-request-review, review-queue, next-steps, templates, today-issues, loop-on-ci | plan and ship work on GitHub |
| [`tooling`](skills/tooling) | package-manager | run the package manager of the repository |

A skill with `disable-model-invocation: true` in its frontmatter starts only through its slash command. The engineering skill and its playbooks read such a skill from its `SKILL.md` instead.

Run `/setup-models` once to pick the model and the reasoning effort of each role a skill of this plugin spawns. It writes `~/.claude/rules/models.md`, and without that file every role runs on its default.

## Claude Code settings

The `git/commit` and `github/pull-request` skills bring their own rules for commits and pull requests. Claude Code also loads built-in commit and pull request instructions into its context, and the two can conflict. If Claude does not follow the skills, turn off the built-in instructions with [`includeGitInstructions`](https://code.claude.com/docs/en/settings-reference.md#includegitinstructions) in `~/.claude/settings.json` or in the project's `.claude/settings.json`:

```json
{
  "includeGitInstructions": false
}
```

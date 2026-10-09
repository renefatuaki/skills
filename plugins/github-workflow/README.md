# github-workflow

Claude Code skills for a GitHub workflow, from the issue on the project board to the reviewed pull request. Everything here talks to GitHub through `gh` and reads and writes GitHub Projects, so the plugin fits a repository hosted on GitHub and nothing else.

## Requirements

- The [`gh` CLI](https://raw.githubusercontent.com/cli/cli/trunk/README.md#installation), logged in with a token whose scopes include `project`. `gh auth refresh -s project` adds the scope.
- A GitHub Project with the fields the `project` skill sets up, Priority and Size among them. The skill creates or extends one.
- The [clean-code](../clean-code/README.md) plugin of this marketplace, which brings the `project-docs`, `diagrams` and `package-manager` skills these skills call. It is declared as a dependency, so installing this plugin installs it too.

## Installation

```sh
claude plugin marketplace add renefatuaki/skills
claude plugin install github-workflow@renefatuaki
```

The `commit` skill installs two upstream skills on first use, after confirmation, `conventional-commit-message` and `committing-with-commitlint`. The `issue` and `implement-issue` skills install `grilling` the same way.

## Skills

| Skill | What it does |
| --- | --- |
| `commit` | one topic per commit, Conventional Commits checked by commitlint, the issue in the footer |
| `issue` | issue forms, an interview for open fields, labels, project fields, epics with sub-issues |
| `project` | a GitHub Project with the field set the other skills rely on |
| `today-issues` | the plan for today's tickets from the project board |
| `implement-issue` | one issue from the board to a draft pull request, with a test per acceptance criterion |
| `pull-request` | a pull request from the branch, with a template, a test plan and the diagrams brought up to date |
| `pull-request-review` | a pull request tested in the running application by its test plan |

Every text the skills write, commit messages, issues, pull requests, reviews and plans, is in English.

## Claude Code settings

Claude Code loads built-in commit and pull request instructions into its context, and they can conflict with the `commit` and `pull-request` skills. If Claude does not follow the skills, turn the built-in instructions off with [`includeGitInstructions`](https://code.claude.com/docs/en/settings-reference.md#includegitinstructions) in `~/.claude/settings.json` or in the project's `.claude/settings.json`:

```json
{
  "includeGitInstructions": false
}
```

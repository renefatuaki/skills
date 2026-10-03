# skills

Claude Code skills for clean code, engineering workflows and project management, packaged as a plugin.

## Requirements

Node 24 or newer, because the hook and the bundled scripts are TypeScript that Node runs directly, and pnpm as named in `package.json`. Install the dependencies with `pnpm install`, which also wires the git hooks.

## Working on the repository

| Command | What it does |
|---|---|
| `pnpm run format` | formats every file with oxfmt |
| `pnpm run format:check` | reports unformatted files |
| `pnpm run lint` | runs oxlint |
| `pnpm run lint:fix` | runs oxlint and applies its fixes |
| `pnpm run typecheck` | checks the `.mts` files with tsc |
| `pnpm test` | runs the fixture tests of the comment hook |

The pre-commit hook judges the staged files with oxfmt and oxlint, the commit-msg hook runs commitlint, and the Check workflow runs all five commands on every pull request and before every release. Each change ships with a changeset under `.changeset/`.

The clean-code skill carries a formatter and linter configuration per language under `skills/clean-code/clean-code/formatting/`. Which rule each tool covers, and where the agent fills the gap, is listed in [coverage.md](skills/clean-code/clean-code/formatting/coverage.md).

## Claude Code settings

The `git/commit` skill brings its own rules for commits. Claude Code also loads built-in commit and pull request instructions into its context, and the two can conflict. If Claude does not follow the skill, turn off the built-in instructions with [`includeGitInstructions`](https://code.claude.com/docs/en/settings-reference#includegitinstructions) in `~/.claude/settings.json` or in the project's `.claude/settings.json`:

```json
{
  "includeGitInstructions": false
}
```

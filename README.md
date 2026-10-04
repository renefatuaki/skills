# skills

Claude Code skills for clean code, engineering workflows and project management, packaged as a plugin.

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
| `pnpm test` | runs the fixture tests of the comment hook, the documentation hook and the diagram hook |

- The pre-commit hook judges the staged files with oxfmt and oxlint.
- The commit-msg hook runs commitlint.
- The [Check workflow](.github/workflows/check.yml) runs the checks on every pull request and before every release.
- Each change ships with a changeset under `.changeset/`.

The clean-code skill carries a formatter and linter configuration per language under `skills/clean-code/clean-code/formatting/`. Which rule each tool covers, and where the agent fills the gap, is listed in [coverage.md](skills/clean-code/clean-code/formatting/coverage.md).

## Claude Code settings

The `git/commit` and `github/pull-request` skills bring their own rules for commits and pull requests. Claude Code also loads built-in commit and pull request instructions into its context, and the two can conflict. If Claude does not follow the skills, turn off the built-in instructions with [`includeGitInstructions`](https://code.claude.com/docs/en/settings-reference.md#includegitinstructions) in `~/.claude/settings.json` or in the project's `.claude/settings.json`:

```json
{
  "includeGitInstructions": false
}
```

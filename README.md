# skills

Claude Code plugins in one marketplace.

| Plugin | What it holds | Needs |
| --- | --- | --- |
| [clean-code](plugins/clean-code/README.md) | clean code, code comments, project documentation and diagrams, with language guides for Swift, Kotlin, Java, TypeScript and Python | nothing beyond Claude Code |
| [github-workflow](plugins/github-workflow/README.md) | commits, issues, the project board, pull requests and their review | the `gh` CLI, GitHub Projects and the clean-code plugin, which it installs as a dependency |

## Installation

Add the marketplace once, then install the plugins you want. `github-workflow` depends on `clean-code`, so installing it alone installs both.

```sh
claude plugin marketplace add renefatuaki/skills
claude plugin install clean-code@renefatuaki
claude plugin install github-workflow@renefatuaki
```

Inside a session, `/plugin marketplace add renefatuaki/skills` and `/plugin install <name>@renefatuaki` do the same. Each plugin README names its skills and what they require.

## Working on the repository

- Node 24 or newer, because the hooks and the bundled scripts are TypeScript that Node runs directly.
- pnpm in the version that [package.json](package.json) names.

Install the dependencies, which also wires the git hooks.

```sh
pnpm install
```

| Command | What it does |
| --- | --- |
| `pnpm run format` | formats every file with oxfmt |
| `pnpm run format:check` | reports unformatted files |
| `pnpm run lint` | runs oxlint |
| `pnpm run lint:fix` | runs oxlint and applies its fixes |
| `pnpm run typecheck` | checks the `.mts` files with tsc |
| `pnpm test` | runs the fixture tests of the comment hook, the documentation hook and the diagram hook |

- Each plugin is a workspace package under `plugins/` with its own version. A change ships with a changeset under `.changeset/` that names the plugin it changes.
- The pre-commit hook judges the staged files with oxfmt and oxlint.
- The commit-msg hook runs commitlint.
- The [Check workflow](.github/workflows/check.yml) runs the checks on every pull request and before every release.
- The [Release workflow](.github/workflows/release.yml) opens a version pull request from the changesets and tags each plugin on merge. `scripts/sync-plugin-version.mts` copies the version of each `package.json` into its `plugin.json`.

## Claude Code settings

The `commit` and `pull-request` skills bring their own rules for commits and pull requests. Claude Code also loads built-in commit and pull request instructions into its context, and the two can conflict. If Claude does not follow the skills, turn off the built-in instructions with [`includeGitInstructions`](https://code.claude.com/docs/en/settings-reference.md#includegitinstructions) in `~/.claude/settings.json` or in the project's `.claude/settings.json`:

```json
{
  "includeGitInstructions": false
}
```

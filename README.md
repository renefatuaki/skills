# skills

## Claude Code settings

The `git/commit` skill brings its own rules for commits. Claude Code also loads built-in commit and pull request instructions into its context, and the two can conflict. If Claude does not follow the skill, turn off the built-in instructions with [`includeGitInstructions`](https://code.claude.com/docs/en/settings-reference#includegitinstructions) in `~/.claude/settings.json` or in the project's `.claude/settings.json`:

```json
{
  "includeGitInstructions": false
}
```

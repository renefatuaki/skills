# antigravity

Use Google's Antigravity CLI `agy` from inside Claude Code to review code or to delegate tasks to Antigravity. The plugin runs `agy` in headless print mode, tracks background jobs and can gate the end of a Claude turn on an Antigravity review.

## Install

Install the plugin from the renefatuaki marketplace.

```text
/plugin install antigravity --marketplace renefatuaki/skills
```

Then run `/antigravity:setup`. It reports whether `agy` is installed and signed in, the models it lists and the usage left. On macOS and Linux it offers to install `agy` when it is missing.

## Requirements

- Node 24 or newer, because the scripts are TypeScript that Node runs directly.
- The Antigravity CLI `agy`, installed and signed in.

Install `agy` with the official installer from the [Antigravity quickstart](https://antigravity.google/docs/getting-started?tab=cli).

```sh
# macOS and Linux
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

```powershell
# Windows PowerShell
irm https://antigravity.google/cli/install.ps1 | iex
```

Check the install with `agy --version`. Sign in by running `!agy` in Claude Code or `agy` in a terminal. Without a saved session the CLI opens the browser to sign in. [Authenticate](https://antigravity.google/docs/install?tab=cli) lists the other sign-in options.

## Sandbox

Claude Code's sandbox denies every write under `~/.claude`, the plugin's data folder included, where the companion keeps its jobs. With the sandbox on, take the companion out of it in `~/.claude/settings.json`, the way you would for the Codex companion. The `*` in the path covers every installed version.

```json
{
  "sandbox": {
    "excludedCommands": [
      "node \"~/.claude/plugins/cache/renefatuaki/antigravity/*/scripts/antigravity-companion.mts\" *",
      "node ~/.claude/plugins/cache/renefatuaki/antigravity/*/scripts/antigravity-companion.mts *"
    ]
  }
}
```

Write your home folder in place of `~`, because Claude Code matches the text of the call. An excluded call still goes through the permission flow. A call with a heredoc, a redirect, `$(...)`, a `cd` or a second command stays sandboxed, so the rescue subagent passes the task as one single-quoted argument. [Run commands outside the sandbox](https://code.claude.com/docs/en/sandboxing.md#run-commands-outside-the-sandbox-with-excludedcommands) explains the rules.

## Commands

| Command | What it does |
| --- | --- |
| `/antigravity:review` | reviews the working tree or the branch against `--base <ref>`, read-only |
| `/antigravity:adversarial-review` | challenges the approach and the design choices, read-only, takes focus text after the flags |
| `/antigravity:rescue` | hands a task to the `antigravity:antigravity-rescue` subagent, write-capable unless the task asks for read-only work |
| `/antigravity:status` | shows running and recent jobs of this repository |
| `/antigravity:result` | shows the stored output of a finished job |
| `/antigravity:cancel` | cancels a background job and stops its `agy` process |
| `/antigravity:setup` | checks `agy` and its sign-in, and turns the stop-time review gate on or off with `--enable-review-gate` or `--disable-review-gate` |

`--model` takes `flash`, `pro`, `argon` or `carbon`, which resolve to the newest slug of that model that `agy models` lists, or a full `gemini-...` slug. `--effort` takes `low`, `medium`, `high`, `xhigh` or `max`. Without them `agy` uses its own defaults.

There is no transfer command, because `agy` cannot import a Claude Code session.

## Read-only and write-capable runs

Every run calls `agy -p <prompt> --output-format json`.

| Run | Extra `agy` flags | What `agy` may do |
| --- | --- | --- |
| Read-only, used by both reviews, the review gate and `task` without `--write` | none, `agy` keeps its default permission mode | read the workspace. `agy` denies file writes and shell commands. Inside a git work tree the run fails with `Antigravity changed files: <paths>` when a file changed anyway |
| Write-capable, used by `task --write`, which `/antigravity:rescue` adds by default | `--mode accept-edits --sandbox --settings '{"permissions":{"allow":["command(*)"]}}'` | edit files in the workspace and run shell commands inside the terminal sandbox |

The plugin never passes `--mode auto` or `--dangerously-skip-permissions`. A foreground run passes `--print-timeout 8m` unless `--timeout <minutes>` sets another limit.

## Credits

The structure of this plugin and much of its text come from the [Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc) by OpenAI, licensed under Apache-2.0. [NOTICE](NOTICE) names the source.

## License

Apache-2.0, see [LICENSE](LICENSE).

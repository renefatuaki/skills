---
"forge": patch
---

Every Codex entry in `~/.claude/rules/models.md` names its model and its effort, such as `codex:astra/xhigh`. The Codex models are `luna`, `sol` and `astra`, and the engineering skill's `codex-model.mts` resolves each to the newest full name the Codex CLI lists, such as `gpt-6-astra`.

A Codex slot no longer starts when the account reached its usage limit or has less of its 5-hour or weekly window left than the `codex minimum` line sets, which `/setup-models` asks for and which defaults to 20 %, unless credits pay for the run. A Codex slot that cannot run falls back to the Claude model of the same rank, `haiku` for `luna`, `sonnet` for `sol`, and `opus` for `astra`, instead of always to `sonnet`.

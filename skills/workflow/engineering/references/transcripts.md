# Session transcripts

Several skills of this plugin read Claude Code session transcripts: recall, reflect, automate-me, show-me-your-work, and the eval and session-pickup playbooks. This file says where they are and how to read them. Skills point here instead of repeating it.

## Find this session's transcript

This plugin's SessionStart hook writes a `session:` line into your context with this session's `session_id` and `transcript_path`. Use that path. It survives `/clear`, resume, and compaction because the hook runs again on each.

The hook line can be missing, for example when hooks are disabled or the plugin was installed mid-session. Then fall back:

1. The project directory is `~/.claude/projects/<project>/`, where `<project>` is the working directory with every non-alphanumeric character replaced by `-`. `/Users/you/proj` becomes `-Users-you-proj`. Paths longer than 200 characters are truncated with a hash suffix, so if the directory is missing, list `~/.claude/projects/` and match on the prefix.
2. List candidates newest first with `ls -t ~/.claude/projects/<project>/*.jsonl | head -10`.
3. Take the file whose first real user message matches this conversation's opening prompt. Several sessions can run in one project at once, so never take the newest file without that check.
4. If nothing matches, write a tight digest of the session and use that instead.

## Layout

All under the project directory, which is the directory of `transcript_path`:

- `<session_id>.jsonl` is a parent session.
- `<session_id>/subagents/agent-<id>.jsonl` is one subagent of that session, with `agent-<id>.meta.json` beside it.

Stay inside this project's directory. Other directories under `~/.claude/projects/` hold private sessions from unrelated projects. Read them only when the user explicitly asks for a cross-project search.

Sessions older than `cleanupPeriodDays` (30 by default) are deleted.

## Read a transcript

The record format is internal to Claude Code and changes between versions. Parse each line as JSON, skip lines that fail, and skip record types you do not need. As of this writing:

- `type: "user"` records hold `message.content`, either a string or a list of blocks. Blocks of `type: "text"` are what the user typed. Blocks of `type: "tool_result"` are tool output. Records with `isMeta: true` are injected context, not user input.
- `type: "assistant"` records hold `message.content` blocks of `type: "text"`, `"thinking"`, and `"tool_use"` (with `name` and `input`).
- Every record carries `timestamp`, `cwd`, `gitBranch`, and `sessionId`.
- Other types (`attachment`, `system`, `last-prompt`, `file-history-snapshot`, and more) are bookkeeping.

Prefer `jq` or a short script over reading raw JSONL into context. Transcripts are large.

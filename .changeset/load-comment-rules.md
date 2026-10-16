---
"forge": patch
---

A PreToolUse hook denies the first edit of a code file until the transcript of the agent holds the `code-comments` rules and the guide of the file's language, and hands both over in the denial. It checks the transcript after the last compaction, so a main session and a subagent get the rules before every first edit. The `engineering` core names the skill as a trigger when code is written or edited, no longer before review.

---
name: next-steps
description: next-steps, what is still open and in which order to do it, as a short numbered list. Use whenever the user asks what is open, what comes next, what to review, merge or test, or wants a fresh summary of the session's open work, even when they do not name the skill.
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/next-steps.mts)
---

Shows what is still open as one short numbered list in the order to do it. The open pull requests of the repository come from GitHub as they are now, the rest from this session.

## Steps

1. **Run the script.** Run [scripts/next-steps.mts](scripts/next-steps.mts) with Node 24 or newer, which runs TypeScript directly. It reads the repository of the current directory and prints one line per open pull request with its next action, in the order of the review-queue skill.

   ```sh
   node ${CLAUDE_SKILL_DIR}/scripts/next-steps.mts
   ```

2. **Add the open points of the session.** Look through this session for work it left open that GitHub does not show, such as a question waiting for the user, a ticket without a pull request or uncommitted changes. A point that blocks a pull request of the list goes right before it, every other point goes at the end. Leave out what is done.
3. **Show the list.** Your reply is the list, renumbered, one line per point, in the language of the conversation, and nothing else. When the script fails, its error is the first line. When nothing is open, say so in one sentence.

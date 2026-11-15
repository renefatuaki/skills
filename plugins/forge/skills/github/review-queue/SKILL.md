---
name: review-queue
description: review-queue, the open pull requests of a repository as a table in the order to review them. Use whenever the user asks which pull requests are open, which one to review next, or in which order to review them.
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/review-queue.mts)
---

Shows the open pull requests of a repository as one table in the order to review them, each linked, with every stack in one piece.

## Steps

1. **Run the script.** Run [scripts/review-queue.mts](scripts/review-queue.mts) with Node 24 or newer, which runs TypeScript directly. It reads the repository of the current directory.

   ```sh
   node ${CLAUDE_SKILL_DIR}/scripts/review-queue.mts
   ```

2. **Show the table.** Your reply is the script's output verbatim and nothing else, no sentence before or after it. When the script fails, reply with its error.


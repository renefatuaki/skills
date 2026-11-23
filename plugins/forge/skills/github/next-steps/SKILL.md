---
name: next-steps
description: next-steps, what is still open and in which order to do it, as a short numbered list. Use whenever the user asks what is open, what comes next, what to review, merge or test, whether anything is still open or ticked off, whether the session can be ended or closed, or wants a fresh summary of the session's open work, in any language and even when they do not name the skill. Picking the next ticket from the backlog belongs to the today-issues skill.
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/next-steps.mts)
---

Shows what is still open as one short numbered list in the order to do it, each point marked with who does it. The open pull requests come from GitHub as they are now, the rest from this session.

## Steps

1. **Run the script.** Run [scripts/next-steps.mts](scripts/next-steps.mts) with Node 24 or newer, which runs TypeScript directly. In a git repository it reads that repository. In a directory that is no git repository it reads every git repository one level below it and names the repository in each line. It prints one line per open pull request with its next action and who does it, `(agent)` or `(you)`, in the order of the review-queue skill.

   ```sh
   node ${CLAUDE_SKILL_DIR}/scripts/next-steps.mts
   ```

2. **Add the open points of the session.** Look through this session for work it left open that GitHub does not show, such as a question waiting for the user, a ticket without a pull request, uncommitted changes or a test step not run yet. Mark each point `(agent)` when you can do it yourself with the tools of this session, and `(you)` when only the user can, such as a decision, a review, a merge or a step that needs a person or a device. A point that blocks a pull request of the list goes right before it, every other point goes at the end. Leave out what is done.
3. **Show the list.** Your reply is the list, renumbered, one line per point, in the language of the conversation, and nothing else. When the script fails, its error is the first line. When nothing is open, say so in one sentence.
4. **Offer the agent's points.** When the list holds at least one `(agent)` point, ask one AskUserQuestion after the list, whether to do the `(agent)` points now. Its options are doing all of them and doing none. When the user agrees, do them, and report only the result.

---
name: cleanup-merged
description: cleanup-merged, the cleanup after the user's merged pull requests. Closes the issues they finished and the epics those complete, removes their worktrees and branches, locally and on GitHub, and fast-forwards the main checkout. Use when the user runs /cleanup-merged after merging pull requests.
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/cleanup-merged.mts), Bash(node ${CLAUDE_SKILL_DIR}/../issue/scripts/tick-criteria.mts *), Bash(node ${CLAUDE_SKILL_DIR}/../../workflow/engineering/scripts/github-issue-status.mts *), Bash(gh auth status:*), Bash(gh issue view:*), Bash(gh issue close:*)
disable-model-invocation: true
---

Cleans up after the user's merged pull requests, which it finds by itself. It closes the issues they finished and the epics those complete, removes their worktrees and branches, and fast-forwards the main checkout. Every deletion runs through its script. Remove nothing yourself, and leave what the script kept.

## Steps

1. **Ensure `gh`.** Run `gh auth status` and do nothing else until it reports a logged-in account whose token scopes include `project`. If `gh` is missing, install it after confirmation, following GitHub's [installation guide](https://raw.githubusercontent.com/cli/cli/trunk/README.md#installation). If nobody is logged in, ask the user to run `! gh auth login`, wait for them, then run `gh auth status` again. If the scope is missing, ask the user to run `! gh auth refresh -s project`. If the user declines, stop and say what is missing.
2. **Run the script.** First `cd` to the primary working directory of the session, in a command of its own. Then run [scripts/cleanup-merged.mts](scripts/cleanup-merged.mts) with Node 24 or newer, which runs TypeScript directly.

   ```sh
   node ${CLAUDE_SKILL_DIR}/scripts/cleanup-merged.mts
   ```

   It cleans the repository of the current directory. When no repository holds the current directory, it cleans every git repository one level below it, such as a workspace of sibling repositories. It reads the 100 merged pull requests that involve the user and were updated last, and keeps those that still leave a local branch, a branch on GitHub or an open issue their closing keyword names. For each it removes the worktree that has its branch checked out, the local branch and the branch on GitHub. It never deletes the default branch, `dev` or the base of an open pull request, a branch with commits the pull request does not hold, a worktree with uncommitted changes to tracked files or the worktree of the current directory. Then it fast-forwards the main checkout when it is on the default branch or `dev`. It prints one entry per repository as JSON.
   - `removed` and `kept` list the worktrees, branches and remote branches of a pull request. A kept entry names its reason in `keptBecause`. A kept `directory` is the folder of a removed worktree that git could not delete.
   - `closes` lists the open issues the pull request closes. `proven` holds the criteria that ticked steps of its test plan name, `unproven` those of unticked steps.
   - `refers` lists the open issues it names with `Refs`.
   - `fastForward` says what happened to the main checkout, and `error` why a repository was skipped.
3. **Close the issues.** Work every entry of `closes`. When `proven` holds numbers, tick them with [tick-criteria.mts](../issue/scripts/tick-criteria.mts) of the issue skill, joined by commas such as `2,5`. Then close the issue and set its Status to Done in every project that holds it with [github-issue-status.mts](../../workflow/engineering/scripts/github-issue-status.mts) of the engineering skill. An issue on no project, which that script reports with `belongs to no project`, needs no Status, and that report is no failure.

   ```sh
   node ${CLAUDE_SKILL_DIR}/../issue/scripts/tick-criteria.mts <issue-url> --criteria <proven>

   gh issue close <issue-url> --reason completed

   node ${CLAUDE_SKILL_DIR}/../../workflow/engineering/scripts/github-issue-status.mts <issue-url> Done
   ```

4. **Close the finished epics.** Read the parent of every issue step 3 closed. An open parent whose `subIssuesSummary.completed` equals its `subIssuesSummary.total` is a finished epic. Tick its Success criteria, close it and set its Status to Done. An epic without a checkbox under Success criteria, which the script reports, is closed all the same.

   ```sh
   gh issue view <issue-url> --json parent --jq '.parent.url // empty'

   gh issue view <epic-url> --json state,subIssuesSummary

   node ${CLAUDE_SKILL_DIR}/../issue/scripts/tick-criteria.mts <epic-url> --all

   gh issue close <epic-url> --reason completed

   node ${CLAUDE_SKILL_DIR}/../../workflow/engineering/scripts/github-issue-status.mts <epic-url> Done
   ```

5. **Reply** in the language of the conversation, one section per repository, named by its folder. First what the run closed and removed, the issues and epics as links, the worktrees, the branches, the remote branches and the result of `fastForward`. Then what is still open, every kept entry with its reason, every `unproven` criterion with its issue, every `refers` issue, every `error` and every command of steps 3 and 4 that failed. The kept directories of all repositories go into one line for the user to run, each path in single quotes, `! rm -rf '<path>' '<path>'`. When no repository lists a pull request, say in one sentence that nothing is left to clean up.

Done when every issue under `closes` is closed and set to Done, every finished epic among their parents is closed, nothing was deleted outside the script, and the reply names what was closed and removed and what is still open, with one `! rm -rf` line for the kept directories when there are any.

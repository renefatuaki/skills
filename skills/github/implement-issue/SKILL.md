---
name: implement-issue
description: implement-issue, the rules for working one GitHub issue to a draft pull request. Use whenever the user wants an issue implemented, names an issue to work on, a today-issues session starts a ticket, or a request describes work that has no issue yet, even when the user did not name the implement-issue skill.
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/set-status.mts *), Bash(git fetch:*), Bash(git switch:*), Bash(git push:*), Bash(gh issue view:*), Bash(gh issue edit:*), Bash(gh issue comment:*), Bash(codex exec:*), Bash(codex review:*)
---

Rules for working one GitHub issue, the ticket, from the board to a draft pull request. This skill takes the ticket over, clears what it leaves open, proves every acceptance criterion with a test, commits criterion by criterion, has Codex read the diff, and opens the draft with the `pull-request` skill. It runs unattended, so it asks only where these steps say so and ends without waiting for the ready word. One ticket per call.

## Steps

1. **Ensure a user and `gh`.** Every step needs a user who can answer. Without one, stop. Run `gh auth status` and do nothing else until it reports a logged-in account whose token scopes include `project`. If `gh` is missing, install it after confirmation, following GitHub's [installation guide](https://raw.githubusercontent.com/cli/cli/trunk/README.md#installation). If nobody is logged in, ask the user to run `! gh auth login`, wait for them, then run `gh auth status` again. If the scope is missing, ask the user to run `! gh auth refresh -s project`. If the user declines, stop and say what is missing.
2. **Ensure the grilling skill.** Look for `grilling` under `.claude/skills/` of the repository or of the user. If it is missing, install it after confirmation, with the "Run a one-off tool" command from the `package-manager` skill.

   ```sh
   pnpx skills add https://github.com/mattpocock/skills --skill grilling
   ```
3. **Find the ticket.** The ticket is the issue number or URL in the prompt. A request without one goes to the `issue` skill first, which creates the ticket, and this skill continues with it. Read it with every field the next steps need.

   ```sh
   gh issue view <number> \
     --repo <owner>/<repo> \
     --json number,title,url,body,labels,state,assignees,parent,subIssuesSummary,blockedBy,projectItems,closedByPullRequestsReferences
   ```

   Five kinds of ticket are not started. Check for them in this order. If one applies, do not create a branch and do not touch the board. Tell the user which case applies, add what the case asks for, and end.
   - **The issue is closed.** `state` is `CLOSED`. Say that the work is done.
   - **The issue is an epic.** `subIssuesSummary.total` is above zero. An epic is never implemented itself, its sub-issues are the tickets. Read them with `gh issue view <number> --json subIssues` and list the open ones.
   - **A blocker is still open.** An entry of `blockedBy` has `state` `OPEN`. Name the blocker. The ticket can start once the blocker's pull request is merged, because that closes the blocker.
   - **The ticket is Blocked.** An entry of `projectItems` has `status.name` `Blocked`. A person set that status, and the comment on the issue says what is missing. Point to that comment.
   - **Someone else is assigned.** `assignees` holds logins, and the logged-in user, `gh api user --jq .login`, is not among them. Name the person and offer to assign the logged-in user instead. Only the user's yes makes it their ticket.
4. **Take the ticket over.** The base is `dev` when `git ls-remote --heads origin dev` lists it, otherwise the default branch from `gh repo view --json defaultBranchRef`. Run `git fetch origin <base>`.
   - **Resume** when `closedByPullRequestsReferences` holds an open pull request, or `git branch --all --list '*/<number>-*'` finds a branch. Switch to that branch, read the pull request with `gh pr view <number> --json body,comments`, and treat every criterion whose test is green as done. Steps 6 to 9 then work the rest, and the `pull-request` skill revises the draft in place of opening one.
   - **Start** otherwise. The branch is `<type>/<number>-<slug>` from `origin/<base>`, with `git switch --create <branch> origin/<base>`. The type comes from the label, `bug` gives `fix`, `feature` gives `feat`, anything else gives `chore`. The slug is the title in lowercase ASCII, words joined by hyphens, cut to the words that name the ticket.

   Then set the Status to In progress in every project that holds the issue, with [scripts/set-status.mts](scripts/set-status.mts), with Node 24 or newer, which runs TypeScript directly, and assign the logged-in user. The script names the projects it changed and those without that option.

   ```sh
   node ${CLAUDE_SKILL_DIR}/scripts/set-status.mts <issue-url> "In progress"

   gh issue edit <number> --repo <owner>/<repo> --add-assignee @me
   ```
5. **Clear what is open.** The criteria are the ticket's measure of done. A feature has Acceptance criteria, Verification and Out of scope, a bug has Steps and Expected, a chore has its Done list. Read them against the code the ticket touches. A ticket is open when a criterion can be read two ways, two criteria contradict each other, or several approaches lead to a result the user would see differently. Then run the `grilling` skill on those points only, every round through the AskUserQuestion tool, the recommended answer first, marked "(Recommended)". The session waits for the answer as long as it runs, that is what the questions budget of `today-issues` pays for. A complete ticket starts without a question. The answers go to two places.
   - The criteria in the body, so the `pull-request` skill reads the test plan from them. Edit with `gh issue edit <number> --body-file -`, the body from a quoted heredoc, the other fields untouched.
   - The decisions, one line each with the date, in one comment with `gh issue comment <number> --body-file -`, in English.

   A contradiction the answers do not resolve, or a criterion that needs something outside the repository, such as an account, a secret, a store listing or a device, goes to step 9 as Blocked.
6. **Prove each criterion.** The runner is the one the repository already uses, found in its test script, its CI workflow or its test folders. A repository without one gets one question through the AskUserQuestion tool, whether to set up the runner that fits its language. On yes, set it up and commit it first with the `commit` skill, `chore: add <runner>`, with the ticket in its footer. On no, every criterion becomes a step of the pull request's test plan in step 9.

   Then work the criteria in the order of the ticket, one at a time.
   - Write one test, named with the wording of the criterion, in Given/When/Then in the syntax of the runner. Run it and see it red.
   - Write the code until the test is green and the suite stays green.
   - Commit test and code with the `commit` skill, with the ticket in the footer, `Refs` on every commit and `Closes` on the last criterion's. The pre-commit hook is the check, there is no other, and a rejection is fixed and committed again. `--no-verify`, `HUSKY=0` and `--amend` stay out.

   A hook or a test that is still red after three attempts goes to step 7. Work the ticket needs but does not name, such as a bug next to the change or a refactoring, stays out of the branch. The `issue` skill creates a ticket for it and step 9 names it. When the ticket cannot be finished without it, link it with `gh issue edit <number> --add-blocked-by <new-number>` and go to step 9 as Blocked.
7. **Rescue with Codex.** Collect the red output, `git diff origin/<base>...HEAD` with the working tree, and the ticket, and ask Codex for a diagnosis, read-only, with the cause and the change it proposes. Use the `codex:codex-rescue` agent when it is among the available agent types, with "diagnose only, do not edit" in the request. Otherwise run the Codex CLI.

   ```sh
   codex exec --sandbox read-only --output-last-message <file> "<prompt>"
   ```

   When neither is there, install the CLI after confirmation with `npm install -g @openai/codex`, following OpenAI's [getting started](https://raw.githubusercontent.com/openai/codex/main/README.md). Apply the diagnosis yourself, so the diff stays from one hand, and run the test or the hook again. When it is still red, or the user declined the install, ask the user through the AskUserQuestion tool, with what you tried and what Codex found, and wait.
8. **Review the diff.** Before the draft, read `git diff origin/<base>...HEAD` once in full, then have Codex read it with the ticket as the review instruction.

   ```sh
   codex review --base <base> "<the title and the criteria of the ticket>"
   ```

   A finding against a criterion, or a correctness finding such as a wrong result, a crash or a missed case, is fixed and committed with the `commit` skill. A finding about style that no rule of the repository backs stays in the code and goes to the Notes for the reviewer. Without Codex, the review is skipped and the Notes say so.
9. **Open the draft, or block.** Run the `pull-request` skill, which pushes the branch and opens the draft, or revises the open one. The Notes for the reviewer carry the review findings left in step 8, the issues step 6 created, and the missing runner when the user declined one. Then end with the draft's URL, the assumptions and the new issues. The ready word is the user's, in this or a later session, and marks the draft ready through the `pull-request` skill, which sets the issue to In review. Nobody is asked to review, because the session runs unattended.

   **Blocked**, from step 5 or 6, ends differently. Push what is committed and open the draft the same way, with the obstacle first under Notes for the reviewer. Comment on the issue with the obstacle, what the user has to do, and the pull request, in English. Then set the Status to Blocked.

   ```sh
   node ${CLAUDE_SKILL_DIR}/scripts/set-status.mts <issue-url> Blocked
   ```

Done when the issue is In progress and assigned to the logged-in user, every criterion is proven by a test named after it or stands as a step of the test plan, each criterion is its own commit, the Codex findings are fixed or noted, the draft exists on GitHub and the reply names it with the assumptions and the new issues, or the issue is Blocked with the obstacle in its comment and in the draft.

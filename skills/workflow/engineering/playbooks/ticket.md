### Ticket

**You own the ticket, from the board to a draft pull request. Plan, delegate, integrate, verify.**

One GitHub issue, the ticket, per run. This playbook takes it over in its own worktree, clears what it leaves open, runs the playbook its label names, proves every acceptance criterion with a test, commits criterion by criterion, has interrogate review the diff, and opens the draft. It runs unattended, so it asks only where these steps say so, every question through the AskUserQuestion tool with the recommended answer first, marked "(Recommended)". It ends without waiting for the ready word.

1. **Ensure a user and `gh`.** Every step needs a user who can answer. Without one, stop. Run `gh auth status` and do nothing else until it reports a logged-in account whose token scopes include `project`. If `gh` is missing, install it after confirmation, following GitHub's [installation guide](https://raw.githubusercontent.com/cli/cli/trunk/README.md#installation). If nobody is logged in, ask the user to run `! gh auth login`, wait for them, then run `gh auth status` again. If the scope is missing, ask the user to run `! gh auth refresh -s project`. If the user declines, stop and say what is missing.
2. **Ensure the grilling skill.** Look for `grilling` in the skill list of the session, under its own name or with a plugin prefix such as `mattpocock-skills:grilling`. If it is missing, install it globally after confirmation, with the "Run a one-off tool" command from the `package-manager` skill. `-g` installs for the user, so every repository finds it.

   ```sh
   pnpx skills add https://github.com/mattpocock/skills --skill grilling -g
   ```
3. **Clear finished worktrees.** These are the worktrees of this repository at `../<repo>-<number>`, as `git worktree list --porcelain` lists them, where `<repo>` is the folder name of the main checkout. Run `git fetch --prune origin`, then read for each worktree the newest pull request of its branch, its upstream, its tip and its changes.

   ```sh
   gh pr list --head <branch> --state all --limit 1 --json state,headRefOid
   git for-each-ref --format='%(upstream:track)' refs/heads/<branch>
   git -C <path> rev-parse HEAD
   git -C <path> status --porcelain
   ```

   A worktree is finished when the pull request is `MERGED` or `CLOSED`, or the upstream reads `[gone]`. It is clean when `status` prints nothing and the branch tip equals the pull request's `headRefOid`. A worktree that is not finished stays. For a finished one, the first case that matches applies.
   - **Merged and clean.** Remove the worktree with `git worktree remove <path>` and delete its branch with `git branch -D <branch>`.
   - **Closed, gone or dirty.** Never remove it. The reply names it with its state and its changes.
4. **Find the ticket.** The ticket is the issue number or URL in the prompt. A request without one goes to the `issue` skill first, which creates the ticket, and this playbook continues with it. Read it with every field the next steps need.

   ```sh
   gh issue view <number> \
     --repo <owner>/<repo> \
     --json number,title,url,body,labels,state,assignees,parent,subIssuesSummary,blockedBy,projectItems,closedByPullRequestsReferences
   ```

   Five kinds of ticket are not started. Check for them in this order. If one applies, do not create a worktree and do not touch the board. Tell the user which case applies, add what the case asks for, and end.
   - **The issue is closed.** `state` is `CLOSED`. Say that the work is done.
   - **The issue is an epic.** `subIssuesSummary.total` is above zero. An epic is never implemented itself, its sub-issues are the tickets. Read them with `gh issue view <number> --json subIssues` and list the open ones.
   - **A blocker is still open.** An entry of `blockedBy` has `state` `OPEN`. Name the blocker. The ticket can start once the blocker's pull request is merged, because that closes the blocker.
   - **The ticket is Blocked.** An entry of `projectItems` has `status.name` `Blocked`. A person set that status, and the comment on the issue says what is missing. Point to that comment.
   - **Someone else is assigned.** `assignees` holds logins, and the logged-in user, `gh api user --jq .login`, is not among them. Name the person and offer to assign the logged-in user instead. Only the user's yes makes it their ticket.
5. **Take the ticket over.** The base is `dev` when `git ls-remote --heads origin dev` lists it, otherwise the default branch from `gh repo view --json defaultBranchRef`. Run `git fetch origin <base>`. The ticket's worktree is `../<repo>-<number>`, next to the main checkout, and every later step runs in it.
   - **Resume** when `closedByPullRequestsReferences` holds an open pull request, or `git branch --all --list '*/<number>-*'` finds a branch. Use the ticket's worktree when it exists, otherwise add it for that branch with `git worktree add ../<repo>-<number> <branch>`. Read the pull request with `gh pr view <branch> --json body,comments`, and treat every criterion whose test is green as done. Steps 7 to 14 then work the rest. Step 7 keeps a design the issue's comments already hold, and Opening a PR revises the draft in place of opening one.
   - **Start** otherwise. The branch is `<type>/<number>-<slug>` from `origin/<base>`, in a new worktree. The type comes from the label, `bug` gives `fix`, `feature` gives `feat`, `refactor` gives `refactor`, anything else gives `chore`. The slug is the title in lowercase ASCII, words joined by hyphens, cut to the words that name the ticket.

     ```sh
     git worktree add -b <branch> ../<repo>-<number> origin/<base>
     ```

   A new worktree lacks what git ignores. Install the dependencies in it with the "Install all" command of the `package-manager` skill, and copy the `.env*` files of the main checkout to the same paths in it.

   Then set the Status to In progress in every project that holds the issue, with `scripts/github-issue-status.mts`, with Node 24 or newer, which runs TypeScript directly, and assign the logged-in user. The script names the projects it changed and those without that option.

   ```sh
   node ${CLAUDE_SKILL_DIR}/scripts/github-issue-status.mts <issue-url> "In progress"

   gh issue edit <number> --repo <owner>/<repo> --add-assignee @me
   ```
6. **Clear what is open.** The criteria are the ticket's measure of done. A feature has Acceptance criteria, Verification and Out of scope, a bug has Steps and Expected, a refactor has Done when and Behaviour to keep, a chore has its Done list. Read them against the code the ticket touches. A ticket is open when a criterion can be read two ways, two criteria contradict each other, or several approaches lead to a result the user would see differently. Then run the `grilling` skill on those points only. A technical fork whose answer you could observe by running something is no question for the user. The Prototype playbook, `playbooks/prototype.md`, settles it. The session waits for an answer as long as it runs, that is what the questions budget of `today-issues` pays for. A complete ticket starts without a question. The answers go to two places.
   - The criteria in the body, so the `pull-request` skill reads the test plan from them. Edit with `gh issue edit <number> --body-file -`, the body from a quoted heredoc, the other fields untouched.
   - The decisions, one line each with the date, in one comment with `gh issue comment <number> --body-file -`, in English.

   A contradiction the answers do not resolve, or a criterion that needs something outside the repository, such as an account, a secret, a store listing or a device, goes to step 13 as Blocked.
7. **Open the playbook.** The label names it. `feature` gives Feature, `playbooks/feature.md`, `bug` gives Bug fix, `playbooks/bug-fix.md`, `refactor` gives Refactoring, `playbooks/refactoring.md`, and any other label gives Feature. Open the todolist now, as the Playbooks section of `references/core.md` asks. It holds these fourteen steps and, under step 7, the steps of the chosen playbook, copied in verbatim. A playbook step that another step of this playbook runs, such as a commit rule or Opening a PR, stays in the list as `in ticket step <n>`. Only a step that does not run at all stays as `skip: <reason>`.

   Feature runs the `how` skill over the affected subsystem here, then the `architect` skill through its Phase C without a checkpoint. Post the picked design and the rejected one in one comment with `gh issue comment <number> --body-file -`, in English. Bug fix runs its steps 1 and 2 here and plans the fix of its step 3. Its delegation is step 8, and its reproduction becomes the bug's test. Refactoring runs its steps 1 to 4 here, after the runner question of step 8 when its pin is a test. Its pin passes on today's code, lands as the first commit after the runner's and proves every criterion under Behaviour to keep, which stays green instead of red. Its subtraction lands as the next commit, so the ticket SHA of step 8 holds the pin and the subtraction. The other steps of both run inside steps 8, 9 and 13. Step 7 ends with a clean ticket worktree. Every run of the `architect` skill in step 7, that of Bug fix step 3 and Refactoring step 3 included, stops after its Phase C. Its Phase D is step 8, its sketch lands in no commit, and the worktrees of its runners are removed like those of step 9. Instrumentation from a bug hunt is removed before step 8.
8. **Implement the criteria.** The runner is the one the repository already uses, found in its test script, its CI workflow or its test folders. A repository without one gets one question, whether to set up the runner that fits its language, unless step 7 asked it for the pin. On yes, set it up and commit it first with the `commit` skill, `chore: add <runner>`, with the ticket in its footer. On no, every criterion becomes a step of the pull request's test plan in step 13.

   Then write the throughput checkpoint over the criteria, Feature step 3 copied in verbatim. The criteria of its independent workstreams run in parallel, the others one after another in ticket order. A criterion that builds on another is spawned once step 9 has committed that one, from the new HEAD. The cleanup of a refactoring builds on its reshape. Each criterion goes to a fresh code subagent, `subagent_type: "forge:engineer"` with `isolation: "worktree"`. Its model role is the playbook's, `feature, refactoring` or `bug-fix`, and `hardest tasks` for the hardest changes, resolved per `references/model-roles.md`. Spawn as many at once as Phase A step 3 of the `swarm` skill allows, in batches when the machine or the limits cannot take them all. In a feature, a criterion whose implementation admits several valid shapes (error handling, abstraction layer, test structure) is built through the `arena` skill instead of a single code subagent, as Feature step 4 asks, every runner with the brief below. The arena's synthesized result is the criterion's diff, integrated like any other. In a refactoring, a criterion under Behaviour to keep gets no subagent, the pin proves it. The criteria under Done when get no new red test, the pin and the equivalence check of Refactoring step 6 prove them. The subagents of a refactoring carry its reshape and its cleanup, which take the place of the criteria here and in step 9. The brief names the criterion, the ticket SHA, `git rev-parse HEAD` in the ticket worktree, the picked design of step 7 when there is one, and the scope its playbook asks for, Feature step 4, Bug fix step 3 or Refactoring step 5.
   - The subagent checks out the ticket SHA and prepares its worktree like a new one in step 5.
   - It writes one test, named with the wording of the criterion, in Given/When/Then in the syntax of the runner, runs it and sees it red. For a bug, the test is the reproduction of step 7, which the brief carries. A refactoring writes no new test, the pin of step 7 stays green.
   - It writes the code until the test is green and the suite stays green.
   - After two failed fixes on one premise, it runs `principle-attack-the-premise`. When the test is still red, it returns what it tried and its census instead of a diff.
   - It runs the `clean-code` and `code-comments` skills over its diff.
   - It works its brief alone and opens no playbook of its own.
   - It never commits and returns its diff against the ticket SHA, new files included. For a bug, it returns the test and the fix as two separate diffs.

   The test follows the `tdd` skill and `principle-test-behavior-not-implementation`. A criterion the `tdd` skill finds impractical to test becomes a step of the test plan, as without a runner, and the Notes for the reviewer say why. A subagent that runs the app gets its own ports, `/tmp` subdirectory and test data. Work the ticket needs but does not name, such as a bug next to the change or a refactoring, stays out of the diff, and the subagent reports it.
9. **Integrate.** Work the diffs in the ticket worktree one criterion at a time, in ticket order, a refactoring in the order of Refactoring step 8.
   - Apply the diff with `git apply --index`, so the `commit` skill finds a stage, and run the suite. For a bug, apply the test diff, see its test red, and commit it before the fix diff follows. When the pre-commit hook rejects the red test, test and fix land as one commit. A diff that does not apply, or turns the suite red beyond a bug's red test, reruns its criterion serially from the current SHA, as a fresh subagent or, for an arena criterion, a fresh arena.
   - Verify a criterion with behaviour a user can see on its surface. A verification that fails or stays inconclusive counts as a red suite. Drive it through the project's `.claude/skills/verify-<app>/` when it exists, otherwise through `control-ui` for a browser or Electron UI and `control-cli` for a CLI or TUI. A repository without `verify-<app>` gets one question, whether to create it with the `create-verification-skill` skill.
   - Commit the criterion with the `commit` skill, with the ticket in the footer, `Refs` on every commit and `Closes` on the last criterion's. The criterion's stage is one commit, so the `commit` skill makes it without a plan to confirm. The pre-commit hook is the check, there is no other, and a rejection is fixed and committed again. `--no-verify`, `HUSKY=0` and `--amend` stay out. Once a criterion is committed, remove the worktree of each subagent that worked it, reruns included, with `git worktree remove --force <path>`, and that worktree's branch with `git branch -D <branch>`.

   Work a subagent reported stays out of the branch. The `issue` skill creates a ticket for it and step 13 names it. When the ticket cannot be finished without it, link it with `gh issue edit <number> --add-blocked-by <new-number>` and go to step 13 as Blocked.
10. **Get unstuck.** A test or a hook that stays red after two fixes on one premise goes to `principle-attack-the-premise` before the next fix. When it is still red, or a subagent returns its census instead of a diff, the main thread asks the user with what was tried and what the census showed, and waits.
11. **Review with interrogate.** Run the `interrogate` skill on every ticket, over `git diff origin/<base>...HEAD`, with its `interrogate reviewers` role, `opus/xhigh` and `codex/xhigh` by default. The intent of its step 2 comes from the ticket's title, its criteria and the design comment of step 7 when there is one. Each finding of the verdict goes one way.
    - **Act on, with a concrete path to the fix.** A fresh code subagent fixes it as in step 8, and step 9 integrates it, one commit per fix.
    - **Act on, about the design or the scope.** The Notes for the reviewer carry it as "needs your call".
    - **Consider.** The Notes for the reviewer carry it.
    - **Noted and Dismissed.** The Notes for the reviewer carry them with their reasons, in a `<details>` block.

    Then a reviewer of the model family that did not write the fixes re-checks the fixed Act on findings once, with that family's entry of the `interrogate reviewers` role, per `references/model-roles.md`. What it still finds goes to the Notes for the reviewer. There is no second round. A panel that ran single-family says so in the Notes for the reviewer.
12. **Check the blast radius.** When the diff changes a schema, a public API, the dependencies or a flag, run the `blast-radius` skill. Its result feeds the Blast radius section of the draft.
13. **Open the draft, or block.** Run Opening a PR, `playbooks/pull-request.md`, which pushes the branch and opens the draft, or revises the open one. Its reply and that of the `pull-request` skill fold into step 14. The `commit` skill of Opening a PR prints its plan and continues, as when no user can answer. The `<details>` block of step 11 stays through the cut pass of the `pull-request` skill and does not count toward its length. The Notes for the reviewer carry what step 11 left there, the issues step 9 created, the criteria step 8 left to the test plan with the reason, and the missing runner when the user declined one. The `pull-request` skill marks the draft ready itself when the conditions of its step 7 hold, and sets the issue to In review. Otherwise the ready word is the user's, in this or a later session. Nobody is asked to review, because the session runs unattended.

    **Blocked**, from step 6 or 9, ends differently. Push what is committed and open the draft the same way, with the obstacle first under Notes for the reviewer. Comment on the issue with the obstacle, what the user has to do, and the pull request, in English. Blocked before any commit, from step 6 or 9, opens no draft, and its comment names no pull request. Then set the Status to Blocked.

    ```sh
    node ${CLAUDE_SKILL_DIR}/scripts/github-issue-status.mts <issue-url> Blocked
    ```
14. **Reply** per Writing the reply in `references/core.md`. Name each principle that shaped a decision and the choice it changed.

**Reply:** the chosen playbook's reply, the pull request's URL and whether it is ready for review or a draft, the assumptions, the new issues, and the finished worktrees step 3 kept.

Done when the issue is In progress and assigned to the logged-in user, every criterion is proven by a test named after it, or by the pin and the equivalence check for a refactoring, and verified on its surface when a user can see it, or stands as a step of the test plan, each criterion is its own commit or a refactoring commits in the order of Refactoring step 8, every interrogate finding is fixed or in the Notes for the reviewer, the pull request exists on GitHub, ready for review or a draft, and the reply names it with the assumptions and the new issues, or the issue is Blocked with the obstacle in its comment and in the draft when there is one.

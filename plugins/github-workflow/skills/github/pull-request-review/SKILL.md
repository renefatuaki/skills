---
name: pull-request-review
description: pull-request-review, the rules for testing a pull request in the running application. Use whenever the user wants a pull request tested or accepted by its test plan, or asks which pull requests wait for their review. Use it before every `gh pr review` you run, even when the user did not name the pull-request-review skill.
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/mark-steps.mts *)
---

Rules for every pull request you test. This skill runs the test plan of a pull request against the running application, the steps it can drive itself and the rest through the reviewer, and posts the result in the format of [assets/review.md](assets/review.md). It judges the application, the diff belongs to a code review. The approval is the reviewer's own click on GitHub, so this skill ends at a comment or a request for changes.

## Steps

1. **Ensure `gh`.** Run `gh auth status` and do nothing else until it reports a logged-in account. If `gh` is missing, install it after confirmation, following GitHub's [installation guide](https://raw.githubusercontent.com/cli/cli/trunk/README.md#installation). If nobody is logged in, ask the user to run `! gh auth login`, wait for them, then run `gh auth status` again. If the user declines, stop and say what is missing.
2. **Pick the pull request.** The number or URL from the request, or the pull request of the current branch when the user means their own. Without either, list the pull requests that wait for the user with `gh pr list --search "review-requested:@me" --json number,title,author,updatedAt`. One is the choice without a question, several go to the user with the AskUserQuestion tool, none ends the skill. Read it with `gh pr view <number> --json number,title,body,author,headRefOid,isCrossRepository,reviewRequests,url`. The test plan is the `## Test plan` section of the body, its steps the numbered checkboxes under `### Steps`. A plan without checkboxes has nothing to test, so say that, post nothing and stop. A pull request from a fork, `isCrossRepository`, runs a stranger's code on this machine, so wait for the user to confirm before step 3.
3. **Check out**, without asking. Note where the repository stands for step 9, the branch from `git branch --show-current` or, when that prints nothing, the commit from `git rev-parse HEAD`. Then fetch the pull request. `<remote>` is the remote of the repository the pull request lives in, `origin` unless the clone is a fork.

   ```sh
   git fetch <remote> pull/<number>/head
   ```

   Both ways below check out `headRefOid` from step 2, so the commit under test is the one the review names.

   **In place.** Check out in place when `git status --porcelain` is empty and the repository has no submodules. The flag stops the checkout when it would overwrite a file git ignores. Use the worktree then.

   ```sh
   git checkout --detach --no-overwrite-ignore <headRefOid>
   ```

   **In a worktree.** In every other case, test in a worktree, so the working tree stays as it is. An aborted run leaves its worktree behind. Before creating a new one, run `git worktree remove --force` on every path in `git worktree list` whose directory name is `<repo>-pr-<number>.` and six characters. Then create the new worktree.

   ```sh
   mktemp -d "${TMPDIR:-/tmp}/<repo>-pr-<number>.XXXXXX"

   git worktree add --detach "<path>" <headRefOid>
   ```

   `<path>` is the path `mktemp` printed. Write it out in every later command, because `$TMPDIR` can differ from one command to the next.
4. **Prepare.** Run what the prerequisites name and you can run, such as installing the dependencies with the command from the `package-manager` skill, migrating and seeding the database, building the app or starting the server in the background. A worktree lacks the files git ignores, so copy those the prerequisites need, such as `.env`, from the working tree, and run `git submodule update --init --recursive` in it when the repository has submodules. A prerequisite you cannot meet, such as an account or a physical device, goes to the reviewer in step 6. Done when every prerequisite is met or on the reviewer's list, and the application is running, checked by opening it once the way the prerequisites describe.
5. **Run your steps.** A step is yours when you can perform its action in the running application and observe the result, such as a command, a request or a page in the browser. Every other step is the reviewer's, and so is every step that needs the state a reviewer's step leaves behind. Run yours in plan order and keep what you observed as the evidence, the output, the response or the text on the page. A step passed when the observation matches the expected result, failed when it differs, and is blocked when it could not run, with the reason. Only an observation makes a step passed, a step you could not observe is blocked. A failed step does not end the run. Every later step still runs, or is blocked when it needs what the failed step should have left behind.
6. **Hand the rest to the reviewer**, in one message. List the prerequisites still open, where the application runs, and every step of the reviewer with its number and expected result. The reviewer answers once for all of them, with all passed or with the numbers that failed or were blocked and what they saw. Skip this step when every step was yours. One case leaves the user out. When the user wrote the pull request and GitHub lists someone else as its requested reviewer, in `reviewRequests`, leave the steps you could not run to that reviewer and mark them Open in the review.
7. **Write the review** from [assets/review.md](assets/review.md), in English, the comments left out.
   - The first line carries the verdict, the count and `headRefOid` cut to seven characters. All steps passed when every step passed, Changes requested when one failed, Not fully tested when none failed and one was blocked or open.
   - One table row per step, in plan order.
   - One finding per failed or blocked step. Without one, the section is left out.
   - The evidence of the steps you passed goes into the collapsed block, which is left out when none of your steps passed.
8. **Post.** When a step failed, show the review and wait for the user to confirm it, because the request blocks the author and the failure may be yours. Corrections go back to step 7. Otherwise post without asking. Every run tests the whole plan against the current head, so [scripts/mark-steps.mts](scripts/mark-steps.mts) first clears the checkboxes of an earlier run and ticks the passed steps, with Node 24 or newer, which runs TypeScript directly. Leave out `--passed` when no step passed. A refused edit leaves the review as the only record.

   ```sh
   node ${CLAUDE_SKILL_DIR}/scripts/mark-steps.mts <number> --passed 1,2,4

   gh pr review <number> \
     --comment \
     --body-file - <<'EOF'
   <review>
   EOF
   ```

   Post with `--request-changes` in place of `--comment` when a step failed and the pull request is someone else's. On the user's own pull request, where `author.login` equals `gh api user --jq .login`, it stays `--comment`, because GitHub accepts neither an approval nor a request for changes from the author. End the reply with the URL of the pull request. When every step passed on someone else's pull request, add that it is now the user's turn to approve it on GitHub.
9. **Leave as found**, on every exit, also when an earlier step ended the run. Stop what you started in step 4. After a checkout in place, return with `git switch <branch>`, or with `git switch --detach <commit>` when step 3 noted a commit. After a worktree, run `git worktree remove --force "<path>"`. Done when the repository stands where step 3 noted, the test's worktree is removed and nothing from step 4 still runs.

Done when the review is on the pull request with one row per step, the description shows a tick on every passed step unless the edit was refused, and step 9 left the repository as it found it.

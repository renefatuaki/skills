---
name: pull-request
description: pull-request, the rules for every GitHub pull request. Use whenever the user wants to open a pull request, wants a pull request template, or when a task ends with opening one. Use it before every `gh pr create` you run, even when the user did not name the pull-request skill.
argument-hint: "[base] [#issue] [reviewer]"
---

Rules for every GitHub pull request you create. A pull request carries a test plan, the steps a reviewer runs in the running application before approving, in the format of [pull_request_template.md](../templates/assets/pull_request_template.md) of the templates skill. This skill opens it ready for review without stopping, always as the user's GitHub App and with the user as reviewer, so the user can approve it. Then it gets the checks green, runs its own test steps and reports every decision it took as an assumption.

## Steps

1. **Ensure `gh`.** Run `gh auth status` and do nothing else until it reports a logged-in account. If `gh` is missing, install it after confirmation, following GitHub's [installation guide](https://raw.githubusercontent.com/cli/cli/trunk/README.md#installation). If nobody is logged in, ask the user to run `! gh auth login`, wait for them, then run `gh auth status` again. If the user declines, stop and say what is missing. Then run `node ${CLAUDE_SKILL_DIR}/scripts/app-token.mts --login`, with Node 24 or newer, which runs TypeScript directly. `${CLAUDE_SKILL_DIR}` is the folder of this file. Write it out in the command, because the shell does not know it. It prints the login of the user's GitHub App, such as `app/<slug>`, which opens every pull request, so the user can approve it. No output means no app is configured. Then stop and say that `~/.config/forge/github-app.json` with `clientId` and `privateKey` is missing. When it fails, stop and quote its error. Never open a pull request under the user's login.

   **As the app.** Every `gh pr` command of this skill that writes to the pull request, the reviewer included, runs with the app's token. The push, `gh stack`, the projects and the reads stay with the user's login, because GitHub gives an app no access to the projects of a user.

   ```sh
   GH_TOKEN="$(node ${CLAUDE_SKILL_DIR}/scripts/app-token.mts)" gh pr <command> …
   ```
2. **Ensure the template.** Read [templates](../templates/SKILL.md) and follow it for the pull request template. Its reply folds into this skill's reply. If the user asked only for a template, this is the end. The body of this pull request follows the asset of the templates skill.
3. **Read the branch.** When `gh pr view --json number,url,state,title,body,baseRefName` finds an open pull request for the branch, steps 4 to 7 revise it in place of opening one. The base is the branch the user or the calling playbook named, otherwise the `baseRefName` of that open pull request, otherwise `dev` when the remote has it and the current branch is another one, otherwise the default branch. Run `git fetch origin <base>`, then read `git status --porcelain`, `git log origin/<base>..HEAD` and `git diff origin/<base>...HEAD`. Stop and say why when the current branch is the base or has no commit beyond it. Uncommitted changes stay out of the pull request.
4. **Find the issue.** Look in the prompt, the branch name and the `Refs`, `Closes`, `Fixes` and `Resolves` trailers of the commits. Read it with `gh issue view <number> --json number,title,body,labels,milestone,projectItems,url`. A branch without an issue gets a pull request without one. Then bring the diagrams up to date. Run the Update steps of the `diagrams` skill for the files of the diff, and commit each diagram that changed with the `commit` skill, `docs: update the <topic> diagram`, with this issue in its footer. A branch that touches no file a diagram links skips this.
5. **Write the title and the body** in English, whatever language the existing pull requests use. The headings stay as the template writes them, because the `pull-request-review` skill finds the test plan by them. The title is a Conventional Commits subject for the whole branch, as the `commit` skill writes one, since a squash merge turns it into the commit message. Then write one value per section, in template order, each filled the way its comment says, the comments left out.
   - Content comes only from the repository, the diff, the commits, the issue and the conversation.
   - The prose follows [technical-writing](../../docs/technical-writing/SKILL.md), every layer except Diátaxis.
   - The person running the session is the author, so the body ends with its last section and carries no line naming an AI and no session link.
   - **Diagram** shows the change when the branch changes a flow or a structure, however small the change is, as the planned state of the `diagrams` skill, with its legend and its consequences. Any other branch leaves the section out.
   - **Scope** is always filled. It names what the branch covers and what it leaves out on purpose, one to three short items.
   - **Tradeoffs** holds only a rejected alternative a reviewer would otherwise ask about, such as the design the [architect](../../workflow/architect/SKILL.md) skill rejected. A branch without a real choice leaves the section out. A case where the new output is worse goes into the examples comment of step 6, not here.
   - **Blast radius** holds the one or two sentences the template comment asks for. They condense the result of the [blast-radius](../../workflow/blast-radius/SKILL.md) skill when it ran, otherwise they come from the diff.
   - **Automated coverage** names the tests that exercise the change, added, changed or already there, and the CI checks that run them.
   - **Prerequisites** take the block of each platform whose paths the diff touches, from [assets/prerequisites/](assets/prerequisites/). `ios.md` for an app built with Xcode, `web.md` for an application in the browser, `api.md` for a service called over the network, `cli.md` for a command line tool or a library. A change that fits none gets a plain list of what the reviewer needs. Every value comes from the repository, such as the scheme from the Xcode project or the start command from `package.json`.
   - **Steps** come from the diff and from the acceptance criteria and the verification of the issue, minus what the automated coverage proves. A reviewer follows each step without reading the code, and each starts where the step before it ended. A step against an API carries its request under the checkbox as an `http` code block with method, URL, headers and body, and its expected result names the status and the response. A step is written for an agent to run. Only a step that needs what an agent cannot get ends its checkbox line with `(needs a person: <reason>)`, such as `(needs a person: a physical iPhone for the camera)`. That is a physical device or its sensors, an account or a payment, or the action or the judgment of another person, such as how a sound or a vibration feels. A step that proves a criterion of the issue still unticked under Acceptance criteria or Done when names it after the expected result as `(criterion <n>)`, `<n>` its place among the checkboxes there, ahead of `(needs a person: <reason>)`, so the `pull-request-review` skill ticks it in the issue once the step passes. A VoiceOver step names the label, the value, the hint or the traits an element must have, which an agent reads from the accessibility tree and checks with `performAccessibilityAudit()`, so it needs no person. When no step is left, such as for a refactoring, documentation or a change the tests prove completely, Steps holds the sentence with the reason and Prerequisites are left out.
   - **Notes for the reviewer** are left out when empty.
   - **Collapsed sections.** Tradeoffs, Automated coverage and Prerequisites put their content under the heading into `<details>` … `</details>`, with a one-line `<summary>` of the gist and a blank line after it. Code in the summary is `<code>`, not backticks. Notes for the reviewer collapse only the review history, into `<details><summary>Review history</summary>` … `</details>`.
   - **A pull request that already exists** is revised from what it says. Read its title and body first, then bring every section up to date with the branch and keep what still holds, whoever wrote it.
   - Cut pass, once the sections are written. Reread the body and delete every sentence, collapsed or not, whose removal changes neither what the reviewer does nor how they judge a step.
   - Metadata. The assignee is the user's login from `gh api user --jq .login`. The reviewer is the user, plus whoever the user named. Label, milestone and projects are the issue's, the projects by the `title` of each of its `projectItems`.
6. **Open the pull request**, ready for review and without asking. Tidy the history with the `tidy-history` skill, naming the base of step 3 and that this skill rebases the layers above. Then push the branch and create the pull request, the body from a quoted heredoc. A flag without a value is left out.

   ```sh
   git push --set-upstream origin <branch>

   gh pr create \
     --base <base> \
     --title "<title>" \
     --assignee <assignee> \
     --reviewer <reviewer> \
     --label <label> \
     --milestone "<milestone>" \
     --body-file - <<'EOF'
   <body>
   EOF
   ```

   Pass `--reviewer` once per reviewer. Add each project as the user, without the app's token, with `gh pr edit <number> --add-project "<project>"`. If the command fails for a missing `project` scope, ask the user to run `! gh auth refresh -s project`. Report a rejected push and stop. Never force it. A failure without a URL may have left the pull request behind, so check `gh pr view` before creating again.

   For a pull request that already exists, push the same way and write the title and the body back in place of creating. Add the reviewers and projects it lacks the same way. GitHub tells nobody about an edited description, so when the test plan changed, add a comment that names the steps that are new, changed or gone.

   ```sh
   gh pr edit <number> \
     --title "<title>" \
     --add-reviewer <reviewer> \
     --body-file - <<'EOF'
   <body>
   EOF

   gh pr comment <number> --body-file - <<'EOF'
   <changes to the test plan>
   EOF
   ```

   **In review.** Set the Status of the issue in the Linked issue section to In review, in every project that holds the issue and has that option. A pull request without an issue skips this. The query below returns one node per project that holds the issue, with the ids the edit needs. The node's `id` is the item, `project.id` the project, `field.id` the Status field, and the option named In review gives the option id. Run the edit once per node. If the query fails for a missing `project` scope, ask the user to run `! gh auth refresh -s project`.

   ```sh
   gh api graphql \
     -f url=<issue-url> \
     -f query='query($url: URI!) {
       resource(url: $url) {
         ... on Issue {
           projectItems(first: 10) {
             nodes {
               id
               project {
                 id
                 field(name: "Status") {
                   ... on ProjectV2SingleSelectField { id options { id name } }
                 }
               }
             }
           }
         }
       }
     }'

   gh project item-edit \
     --project-id <project-id> \
     --id <item-id> \
     --field-id <field-id> \
     --single-select-option-id <option-id>
   ```

   **Stack.** A pull request whose base is the branch of another open pull request, `gh pr list --head <base> --state open --json number`, is a layer of a stack. The `gh stack` extension links and rebases the layers. When `gh extension list` lacks `github/gh-stack`, install it after confirmation, or without one in an unattended run such as an auto run of the Ticket playbook.

   ```sh
   gh extension install github/gh-stack
   ```

   - **Link** a layer this run opened. Read the stack number of the pull request below. When it has one, append the branch to that stack, otherwise create the stack from both. The trunk is `dev` when the remote has it, otherwise the default branch. Exit code 9 means stacked pull requests are off for the repository, and the pull request stays on its base unlinked.

     ```sh
     gh api repos/<owner>/<repo>/pulls/<below> --jq '.stack.number // empty'

     gh stack link <stack-number> <branch>
     gh stack link --base <trunk> <base> <branch>
     ```
   - **Rebase the layers above** after every push of this run, those of step 7 included, when `gh pr list --base <branch> --state open --json number` lists a pull request. From the branch's worktree, drop the local copy of the stack, which can lack a layer added since and then rebase nothing above it, import the stack from GitHub by the pull request of this branch, rebase every layer above it, also those checked out in other worktrees, and push them. `unstack --local` exits with 2 when no local stack holds the branch, which is fine. The push forces with lease, which this skill allows only here.

     ```sh
     gh stack unstack --local
     gh stack checkout <number>
     gh stack rebase --upstack
     gh stack push
     ```

     Exit code 3 is a conflict, which `gh stack rebase --abort` undoes. A worktree with uncommitted changes makes the rebase refuse before it changes anything. Either way the layers above stay as they were.

   **Before and after.** When the diff changes what the application shows, post one comment with every changed screen before and after, in the format of [assets/before-after.md](assets/before-after.md). When you are unsure, capture.
   - **Capture** the base and the head, each in its own worktree with the application running. Drop every pair whose images are identical.
     - A web application gets `desktop` at the viewport the prerequisites name, otherwise 1280x800, and `mobile` at 360x800. Use the `control-ui` skill, or `playwright screenshot --channel chrome --viewport-size <width>,<height> <url> <file>` through the one-off runner of the `package-manager` skill. Chrome's own `--headless --screenshot` renders a page at least 500 pixels wide and never shows the mobile view.
     - An iOS app runs on the simulator of the prerequisites, `<device>` its UDID from `xcrun simctl list devices`. `xcrun simctl bootstatus <device> -b` boots it and waits until it is ready, then `xcrun simctl status_bar <device> override --time 9:41` keeps the clock equal. Build, install and launch the app from each worktree before its images, the base first, so every image shows the app of its own worktree. Then set up the State of the prerequisites, open each screen and take its image.

       ```sh
       xcodebuild build \
         -scheme <scheme> \
         -destination "platform=iOS Simulator,id=<device>" \
         -derivedDataPath <worktree>/DerivedData

       xcrun simctl uninstall <device> <bundle-id>
       xcrun simctl install <device> <worktree>/DerivedData/Build/Products/<configuration>-iphonesimulator/<app>.app
       xcrun simctl launch <device> <bundle-id>

       xcrun simctl io <device> screenshot <file>
       ```

     - Any other platform uses the tool of its test steps.
   - **Upload** the images to `pr-<number>/<head7>/` on the orphan branch `pr-assets`, created on the first upload. Commit and push with `--no-verify`, because the repository's hooks also run there. Never force the push. Then delete the local `pr-assets` branch, so the user's repository keeps no copy of it. Link each image as `https://github.com/<owner>/<repo>/blob/<full-sha>/<path>?raw=true`, with the full SHA of the `pr-assets` commit.
   - **Post.** The pull request has one such comment, found by its first line `<!-- forge:before-after -->`. Replace its body on every revision, otherwise post it. When no pair is left or the capture fails, write the marker and one line with the reason instead. Step 8 names the reason.
   - **Check**, before step 7. When the first command below prints a file, the second must print 1. When the second prints 0, capture and post now.

     ```sh
     git diff --name-only origin/<base>...HEAD \
       | grep -iE '(View|ViewController|Screen|Cell|Sheet|Modifier)\.swift$|\.(storyboard|xib|css|scss|sass|less|vue|svelte)$|\.xcassets/|(^|/)(ui|design|theme|components|pages|views|screens|layouts|styles)/'

     gh pr view <number> --json comments \
       --jq '[.comments[] | select(.body | startswith("<!-- forge:before-after -->"))] | length'
     ```

   **Examples.** When the diff changes what code, a script or a skill outputs or writes, such as text, data, a response, a message or a file, post one comment with real examples of each changed behaviour, in the format of [assets/examples.md](assets/examples.md). A change only to screens has its before and after comment instead. A refactoring that keeps every output gets no comment.
   - **Collect** the rows from a real run of the base and the head, each in its own worktree, on real inputs of the repository, such as its fixtures, its test data, its own files or the requests of the test plan. Never invent an input. Two to five rows per behaviour, the typical case first, then the edge cases the diff touches. Drop every row whose outputs are equal. When the output cannot be run, such as a rule of a skill, take real texts the rule applies to from the repository or from its issues and pull requests, and show them as the rule writes them now. The source line then says that the rule was applied by hand.
   - **Tradeoffs** holds the rows of real inputs where the head is worse than the base or loses something, such as an acronym a lowercase rule now writes in lowercase, one line each. Without such a row the section is left out.
   - **Post.** The pull request has one such comment, found by its first line `<!-- forge:examples -->`. Replace its body on every revision, otherwise post it. When the run fails, write the marker and one line with the reason instead. Step 8 names the reason.
7. **Get it green and test it**, on the pull request this run opened or revised.
   - **Checks.** Spawn the `forge:ci-watcher` agent for this pull request and wait for its report, which says whether every check passed and quotes the failure when one did not. When a check failed, read [loop-on-ci](../loop-on-ci/SKILL.md) and follow it on this pull request until every check passes. Commit each fix with the `commit` skill. Where loop-on-ci says main, it means the base of step 3, merged without a rebase. When two fixes for the same failure did not turn it green, stop the loop, and step 8 names the failure.
   - **Test steps.** When the test plan holds a step you can run yourself, read [pull-request-review](../pull-request-review/SKILL.md) and follow it on this pull request, without its step 6, which hands steps to a person, and without the confirmation its step 8 asks for after a failed step, because on the app's pull request the result is only a comment. It runs those steps, ticks the passed ones and posts its result. Only a step that step 5 marks `(needs a person: <reason>)` stays for the reviewer. An unattended session runs every other step too.

   After the run, every unticked step that did not fail ends its checkbox line with `(needs a person: <reason>)`. `needs a person` without a reason does not count. Add the missing ones with `gh pr edit`, until the command below prints only the failed steps.

   ```sh
   gh pr view <number> --json body --jq .body \
     | grep -E '^\s*[-*] \[ \] [0-9]+\.' \
     | grep -vE '\(needs a person: [^)]+\)'
   ```
8. **Hand over.** Reply with the URL and the title, then every check and every test step that failed or could not run. Then the assumptions, one line each.
   - The base, when the user did not name it.
   - For a layer of a stack, its pull requests bottom to top, or why it is not linked, and the layers above that a rebase left as they were.
   - The issue and where it was found, or that the pull request has none.
   - The platforms of the prerequisites, and every value the repository did not settle.
   - The uncommitted files left out.
   - The commits before and after the tidy, or why it did not run.
   - When the diff changes what the application shows, the screens with before and after images, or why there are none.
   - When the diff changes an output, the behaviours of the examples comment and its tradeoffs, or why there is none.
   - For an updated pull request, the steps that are new, changed or gone.

   End the reply by saying that the pull request waits for the user's approval.

Done when the pull request exists on GitHub ready for review, opened by the app, with the user and every named reviewer requested, or the open pull request carries the new test plan, with every section filled or left out as step 5 says, the history holds one commit per change with the tree unchanged unless a person had reviewed it, the pull request is in every project of its issue, the issue is In review, the diagrams that link a file of the branch are true for it, the pull request of a visible change carries the before and after comment of the current head, with its images or the reason why there are none, the pull request of a changed output carries the examples comment of the current head, with its real rows or the reason why there are none, the check of step 6 passes, a layer of a stack is linked and the layers above it rebased, or the reply says why not, the checks ran through loop-on-ci, the steps an agent can run are tested, every unticked step that did not fail ends with `(needs a person: <reason>)`, and the reply lists the failures and the assumptions.

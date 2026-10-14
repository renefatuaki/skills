---
name: pull-request
description: pull-request, the rules for every GitHub pull request. Use whenever the user wants to open a pull request, says a draft is ready for review, wants a pull request template, or when a task ends with opening one. Use it before every `gh pr create` you run, even when the user did not name the pull-request skill.
---

Rules for every GitHub pull request you create. A pull request carries a test plan, the steps a reviewer runs in the running application before approving, in the format of [pull_request_template.md](../templates/assets/pull_request_template.md) of the templates skill. This skill opens it as a draft without stopping, marks it ready itself when the checks pass, its own test steps pass and nothing is left open, reports every decision it took as an assumption, and otherwise marks it ready on the user's word.

## Steps

1. **Ensure `gh`.** Run `gh auth status` and do nothing else until it reports a logged-in account. If `gh` is missing, install it after confirmation, following GitHub's [installation guide](https://raw.githubusercontent.com/cli/cli/trunk/README.md#installation). If nobody is logged in, ask the user to run `! gh auth login`, wait for them, then run `gh auth status` again. If the user declines, stop and say what is missing. When the user called a draft ready, continue at step 9.
2. **Ensure the template.** Read [templates](../templates/SKILL.md) and follow it for the pull request template. Its reply folds into this skill's reply. If the user asked only for a template, this is the end. The body of this pull request follows the asset of the templates skill.
3. **Read the branch.** The base is the branch the user named, otherwise `dev` when the remote has it and the current branch is another one, otherwise the default branch. Run `git fetch origin <base>`, then read `git status --porcelain`, `git log origin/<base>..HEAD` and `git diff origin/<base>...HEAD`. Stop and say why when the current branch is the base or has no commit beyond it. Uncommitted changes stay out of the pull request. When `gh pr view --json number,url,isDraft,state,title,body` finds an open pull request for the branch, steps 4 to 7 revise it in place of opening one.
4. **Find the issue.** Look in the prompt, the branch name and the `Refs`, `Closes`, `Fixes` and `Resolves` trailers of the commits. Read it with `gh issue view <number> --json number,title,body,labels,milestone,url`. A branch without an issue gets a pull request without one. Then bring the diagrams up to date. Run the Update steps of the `diagrams` skill for the files of the diff, and commit each diagram that changed with the `commit` skill, `docs: update the <topic> diagram`, with this issue in its footer. A branch that touches no file a diagram links skips this.
5. **Write the draft** in English, whatever language the existing pull requests use. The headings stay as the template writes them, because the `pull-request-review` skill finds the test plan by them. The title is a Conventional Commits subject for the whole branch, as the `commit` skill writes one, since a squash merge turns it into the commit message. Then write one value per section, in template order, each filled the way its comment says, the comments left out.
   - Content comes only from the repository, the diff, the commits, the issue and the conversation.
   - The prose follows [technical-writing](../../docs/technical-writing/SKILL.md), every layer except Diátaxis.
   - The person running the session is the author, so the body ends with its last section and carries no line naming an AI and no session link.
   - **Diagram** shows the change when the branch changes a flow or a structure, however small the change is, as the planned state of the `diagrams` skill, with its legend and its consequences. Any other branch leaves the section out.
   - **Scope** is always filled. It names what the branch covers and what it leaves out on purpose, one to three short items.
   - **Tradeoffs** holds only a rejected alternative a reviewer would otherwise ask about, such as the design the [architect](../../workflow/architect/SKILL.md) skill rejected. A branch without a real choice leaves the section out.
   - **Blast radius** holds the one or two sentences the template comment asks for. They condense the result of the [blast-radius](../../workflow/blast-radius/SKILL.md) skill when it ran, otherwise they come from the diff.
   - **Automated coverage** names the tests that exercise the change, added, changed or already there, and the CI checks that run them.
   - **Prerequisites** take the block of each platform whose paths the diff touches, from [assets/prerequisites/](assets/prerequisites/). `ios.md` for an app built with Xcode, `web.md` for an application in the browser, `api.md` for a service called over the network, `cli.md` for a command line tool or a library. A change that fits none gets a plain list of what the reviewer needs. Every value comes from the repository, such as the scheme from the Xcode project or the start command from `package.json`.
   - **Steps** come from the diff and from the acceptance criteria and the verification of the issue, minus what the automated coverage proves. A reviewer follows each step without reading the code, and each starts where the step before it ended. A step against an API carries its request under the checkbox as an `http` code block with method, URL, headers and body, and its expected result names the status and the response. A step is written for an agent to run. Only a step that needs a person for a reason of step 5 of [pull-request-review](../pull-request-review/SKILL.md) ends with that reason in parentheses, such as `(needs a physical iPhone for the camera)`. When no step is left, such as for a refactoring, documentation or a change the tests prove completely, Steps holds the sentence with the reason and Prerequisites are left out.
   - **Notes for the reviewer** are left out when empty.
   - **Collapsed sections.** Tradeoffs, Automated coverage and Prerequisites put their content under the heading into `<details>` … `</details>`, with a one-line `<summary>` of the gist and a blank line after it. Code in the summary is `<code>`, not backticks. Notes for the reviewer collapse only the review history, into `<details><summary>Review history</summary>` … `</details>`.
   - **A pull request that already exists** is revised from what it says. Read its title and body first, then bring every section up to date with the branch and keep what still holds, whoever wrote it.
   - Cut pass, once the sections are written. Reread the draft and delete every sentence, collapsed or not, whose removal changes neither what the reviewer does nor how they judge a step.
   - Metadata. The assignee is the author. Label and milestone are the issue's. The reviewer is the one the user named and waits for step 8.
6. **Open the draft**, without asking. Push the branch, then create the pull request, the body from a quoted heredoc. A flag without a value is left out.

   ```sh
   git push --set-upstream origin <branch>

   gh pr create \
     --draft \
     --base <base> \
     --title "<title>" \
     --assignee @me \
     --label <label> \
     --milestone "<milestone>" \
     --body-file - <<'EOF'
   <body>
   EOF
   ```

   Report a rejected push and stop, never force it. A failure without a URL may have left the pull request behind, so check `gh pr view` before creating again.

   For a pull request that already exists, draft or ready, push the same way and write the title and the body back in place of creating. GitHub tells nobody about an edited description, so only when the pull request is ready for review and the test plan changed, add a comment that names the steps that are new, changed or gone.

   ```sh
   gh pr edit <number> \
     --title "<title>" \
     --body-file - <<'EOF'
   <body>
   EOF

   gh pr comment <number> --body-file - <<'EOF'
   <changes to the test plan>
   EOF
   ```

   **Before and after.** When the diff changes what the application shows, post one comment with every changed screen before and after, in the format of [assets/before-after.md](assets/before-after.md). When you are unsure, capture.
   - **Capture** the base and the head, each in its own worktree with the application running. Drop every pair whose images are identical.
     - A web application gets `desktop` at the viewport the prerequisites name, otherwise 1280x800, and `mobile` at 360x800. Use the `control-ui` skill, or `playwright screenshot --channel chrome --viewport-size <width>,<height> <url> <file>` through the one-off runner of the `package-manager` skill. Chrome's own `--headless --screenshot` renders a page at least 500 pixels wide and never shows the mobile view.
     - An iOS app runs on the simulator of the prerequisites. `xcrun simctl status_bar <device> override --time 9:41` keeps the clock equal, `xcrun simctl io <device> screenshot <file>` takes each image.
     - Any other platform uses the tool of its test steps.
   - **Upload** the images to `pr-<number>/<head7>/` on the orphan branch `pr-assets`, created on the first upload. Commit and push with `--no-verify`, because the repository's hooks also run there. Never force the push. Then delete the local `pr-assets` branch, so the user's repository keeps no copy of it. Link each image as `https://github.com/<owner>/<repo>/blob/<full-sha>/<path>?raw=true`, with the full SHA of the `pr-assets` commit.
   - **Post.** The pull request has one such comment, found by its first line `<!-- forge:before-after -->`. Replace its body on every revision, otherwise post it. When no pair is left or the capture fails, write the marker and one line with the reason instead. Step 8 names the reason.
7. **Decide ready.** A draft this run opened or revised turns ready for review without asking when every condition below holds. A pull request that is already ready for review skips this step.
   - **Nothing waits for the user.** The user did not ask for a draft. Notes for the reviewer names no obstacle and no decision the user has to make, such as a blocked Ticket run or a finding marked "needs your call".
   - **No assumption is open.** Step 8 will list no value the repository did not settle, and no uncommitted file was left out of the pull request.
   - **Every check passes.** Spawn the `forge:ci-watcher` agent for this pull request and wait for its report, which says whether every check passed and quotes the failure when one did not. A pull request without checks meets this condition. When a check failed, read [loop-on-ci](../loop-on-ci/SKILL.md) and follow it on this pull request until every check passes. Commit each fix with the `commit` skill. Where loop-on-ci says main, it means the base of step 3, merged without a rebase. When two fixes for the same failure did not turn it green, stop, and the pull request stays a draft.
   - **Every test step you can run passes.** When the test plan holds a step you can run yourself, read [pull-request-review](../pull-request-review/SKILL.md) and follow it on this pull request, without its step 6, which hands steps to a person, and without the confirmation its step 8 asks for after a failed step, because on your own pull request the result is only a comment. It runs those steps, ticks the passed ones and posts its result. A step that failed, or that it could not run, keeps the draft. Only a step that needs a person for a reason step 5 of pull-request-review names stays for the reviewer, and carries that reason in parentheses. An unattended session runs every other step too. A test plan without a step you can run meets this condition.

   Check the conditions in this order. The first that fails ends this step, and the pull request stays a draft. When all hold, mark it ready with step 9, without waiting for the user.
8. **Hand over.** Reply with the URL and the title, whether it is ready for review or still a draft, and for a draft the condition of step 7 that kept it. Then the assumptions, one line each.
   - The base, when the user did not name it.
   - The issue and where it was found, or that the pull request has none.
   - The platforms of the prerequisites, and every value the repository did not settle.
   - The uncommitted files left out.
   - When the diff changes what the application shows, the screens with before and after images, or why there are none.
   - The reviewer, or that none was named.
   - For an updated pull request, the steps that are new, changed or gone.

   End the reply of a draft by saying that it stays a draft until the user calls it ready.
9. **Mark ready**, from step 7 or on the user's word, in this run or a later one. From step 7, the pull request is the one this run opened or revised. On the user's word, it is the one the user named, otherwise the open one of the current branch, otherwise the single draft in `gh pr list --author @me --draft --json number,title,url`. Several drafts go to the user with the AskUserQuestion tool. A reviewer the user named is requested with the `--add-reviewer` command below. When the user named nobody, skip that command and say that the pull request is ready for review but nobody was asked to review it.

   ```sh
   gh pr ready <number>

   gh pr edit <number> --add-reviewer <login>
   ```

   Then set the Status of the issue in the Linked issue section to In review, in every project that holds the issue and has that option. A pull request without an issue skips this. The query below returns one node per project that holds the issue, with the ids the edit needs. The node's `id` is the item, `project.id` the project, `field.id` the Status field, and the option named In review gives the option id. Run the edit once per node. If the query fails for a missing `project` scope, ask the user to run `! gh auth refresh -s project`.

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

   When the user called it ready and step 7 did not already run the test steps against the current head, test what an agent can. When the test plan holds a step you can run yourself, read [pull-request-review](../pull-request-review/SKILL.md) and follow it on this pull request, which runs those steps and ticks the passed ones. When every step needs a person, end here and say that the review is theirs to start.

Done when the draft exists on GitHub, or the open pull request carries the new test plan, with every section filled or left out as step 5 says, the diagrams that link a file of the branch are true for it, the pull request of a visible change carries the before and after comment of the current head, or step 8 names the reason, and the reply lists the assumptions and whether the pull request is ready, and, once step 7 or the user called it ready, the pull request is ready for review, the named reviewer is requested, the issue is In review and the steps an agent can run are tested.

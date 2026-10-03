---
name: pull-request
description: pull-request, the rules for every GitHub pull request. Use whenever the user wants to open a pull request, says a draft is ready for review, wants a pull request template, or when a task ends with opening one. Use it before every `gh pr create` you run, even when the user did not name the pull-request skill.
---

Rules for every GitHub pull request you create. A pull request carries a test plan, the steps a reviewer runs in the running application before approving, in the format of [assets/pull_request_template.md](assets/pull_request_template.md). This skill opens it as a draft without stopping, reports every decision it took as an assumption, and marks it ready on the user's word.

## Steps

1. **Ensure `gh`.** Run `gh auth status` and do nothing else until it reports a logged-in account. If `gh` is missing, install it after confirmation, following GitHub's [installation guide](https://raw.githubusercontent.com/cli/cli/trunk/README.md#installation). If nobody is logged in, ask the user to run `! gh auth login`, wait for them, then run `gh auth status` again. If the user declines, stop and say what is missing. When the user called a draft ready, continue at step 8.
2. **Ensure the template.** Read the repository with `gh repo view --json nameWithOwner,defaultBranchRef`. Look for `pull_request_template.md`, in any letter case, in `.github/`, the root and `docs/`, then in the owner's `.github` repository with `gh api repos/<owner>/.github/contents/.github/pull_request_template.md -H "Accept: application/vnd.github.raw+json"`. A template whose `## Test plan` section holds `### Steps` with numbered checkboxes is used unchanged. Any other case is the one question of this skill, asked with the AskUserQuestion tool. A request for the template is the yes.
   - **No template.** Offer to install this skill's.
   - **A template without that test plan.** Offer to replace it, and name the sections it would lose.
   - **On yes**, write `.github/pull_request_template.md` from the asset, with `<prerequisites>` replaced by the block of every platform the repository ships, as step 5 maps them. A repository with several platforms gets one block per platform, each under its own `#### <platform>` heading. A template it replaces, in `.github/`, the root or `docs/`, is first moved to that path with `git mv <old> .github/pull_request_template.md`, which also renames one that differs only in letter case, so the repository holds one template under the new name. A template in the owner's `.github` repository stays. Stage the template with `git add` and commit only that path with the `commit` skill, `chore: add pull request template`. Files the user had staged before are not part of this commit. They stay staged, untouched, for the user to commit later. The template belongs to no issue, which answers the `commit` skill's question about one. Say that GitHub reads the template from the default branch only.
   - **On no**, the body of this pull request follows the asset, or the repository's template with the asset's `## Test plan` section appended. The question returns with the next pull request.
   - If the user asked only for a template, the commit is the end. On the default branch, switch to a new branch `chore/pull-request-template` before writing the file and continue with step 3 after the commit, so the template reaches the default branch through its own draft.
3. **Read the branch.** The base is the branch the user named, otherwise `dev` when the remote has it and the current branch is another one, otherwise the default branch. Run `git fetch origin <base>`, then read `git status --porcelain`, `git log origin/<base>..HEAD` and `git diff origin/<base>...HEAD`. Stop and say why when the current branch is the base or has no commit beyond it. Uncommitted changes stay out of the pull request. When `gh pr view --json number,url,isDraft,state,title,body` finds an open pull request for the branch, steps 4 to 7 revise it in place of opening one.
4. **Find the issue.** Look in the prompt, the branch name and the `Refs`, `Closes`, `Fixes` and `Resolves` trailers of the commits. Read it with `gh issue view <number> --json number,title,body,labels,milestone,url`. A branch without an issue gets a pull request without one.
5. **Write the draft.** Take the language from the last twenty pull requests, `gh pr list --limit 20 --state all --json title,body`, and from the log when the repository has none. The headings stay as the template writes them, because the `pull-request-review` skill finds the test plan by them. The title is a Conventional Commits subject for the whole branch, as the `commit` skill writes one, since a squash merge turns it into the commit message. Then write one value per section, in template order, each filled the way its comment says, the comments left out.
   - Content comes only from the repository, the diff, the commits, the issue and the conversation.
   - The person running the session is the author, so the body ends with its last section and carries no line naming an AI and no session link.
   - **Automated coverage** names the tests that exercise the change, added, changed or already there, and the CI checks that run them.
   - **Prerequisites** take the block of each platform whose paths the diff touches, from [assets/prerequisites/](assets/prerequisites/). `ios.md` for an app built with Xcode, `web.md` for an application in the browser, `api.md` for a service called over the network, `cli.md` for a command line tool or a library. A change that fits none gets a plain list of what the reviewer needs. Every value comes from the repository, such as the scheme from the Xcode project or the start command from `package.json`.
   - **Steps** come from the diff and from the acceptance criteria and the verification of the issue, minus what the automated coverage proves. A reviewer follows each step without reading the code, and each starts where the step before it ended. A step against an API carries its request under the checkbox as an `http` code block with method, URL, headers and body, and its expected result names the status and the response. When no step is left, such as for a refactoring, documentation or a change the tests prove completely, Steps holds the sentence with the reason and Prerequisites are left out.
   - **Notes for the reviewer** are left out when empty.
   - **A pull request that already exists** is revised from what it says. Read its title and body first, then bring every section up to date with the branch and keep what still holds, whoever wrote it.
   - Cut pass, once the sections are written. Reread the draft and delete every sentence whose removal changes neither what the reviewer does nor how they judge a step.
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
7. **Hand over.** Reply with the URL and the title, then the assumptions, one line each.
   - The base, when the user did not name it.
   - The issue and where it was found, or that the pull request has none.
   - The platforms of the prerequisites, and every value the repository did not settle.
   - The uncommitted files left out.
   - The reviewer, or that none was named.
   - For an updated pull request, the steps that are new, changed or gone.

   End the reply by saying that a draft stays a draft until the user calls it ready.
8. **Mark ready**, on the user's word, in this run or a later one. The pull request is the one the user named, otherwise the open one of the current branch, otherwise the single draft in `gh pr list --author @me --draft --json number,title,url`. Several drafts go to the user with the AskUserQuestion tool. A reviewer the user named is requested with the `--add-reviewer` command below. When the user named nobody, skip that command and say that the pull request is ready for review but nobody was asked to review it.

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

   Then test what an agent can. When the test plan holds a step you can run yourself, continue with the `pull-request-review` skill on this pull request, which runs those steps and ticks the passed ones. When every step needs a person, end here and say that the review is theirs to start.

Done when the draft exists on GitHub, or the open pull request carries the new test plan, with every section filled or left out as step 5 says and the reply lists the assumptions, and, once the user called it ready, the pull request is ready for review, the named reviewer is requested, the issue is In review and the steps an agent can run are tested.

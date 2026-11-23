---
name: release
description: release, opens the release pull request from dev to the default branch, in the current repository or in every repository of a workspace folder. Use when the user runs /release, optionally naming the repositories.
disable-model-invocation: true
argument-hint: "[repository …]"
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/releases.mts), Bash(node ${CLAUDE_SKILL_DIR}/scripts/releases.mts *)
---

Opens one release pull request per repository, from `dev` to the default branch, or brings the open one up to date. It ships `dev` as it is, without tidying its history, splitting it into a stack or trimming it. It pushes nothing, merges nothing and keeps the branch flow as it is. The user's GitHub App opens every pull request with the user as reviewer, so the user can approve it.

## Steps

1. **Ensure `gh`.** Run `gh auth status` and do nothing else until it reports a logged-in account. If nobody is logged in, ask the user to run `! gh auth login`, wait for them, then run `gh auth status` again.
2. **Find the releases.** Run [scripts/releases.mts](scripts/releases.mts) with Node 24 or newer, which runs TypeScript directly, in the working directory and with the repositories the user named.

   ```sh
   node ${CLAUDE_SKILL_DIR}/scripts/releases.mts [repository …]
   ```

   Inside a repository it reads that repository. Elsewhere it reads every checkout one level below the working directory. A name selects the folder of that name, or the one whose name ends with `-<name>`. It prints JSON with two lists:
   - `releases`, one per repository whose `dev` is ahead of its default branch. Each holds its `path`, its `repository` as `<owner>/<repo>`, its `defaultBranch`, the open release `pullRequest` or null, the `shipped` pull requests whose merge commit `dev` holds beyond the default branch, and all their `issues`. Each shipped pull request holds the `issues` its description closes and its `openSteps`, the numbers of its unticked test steps.
   - `skipped`, every other repository with its `reason`.

   When it fails, reply with its error. When `releases` is empty, reply with the reasons of `skipped` and stop. Steps 3 to 6 run once per release, one repository after another and never in parallel, each `gh` command from the repository's `path` with `--repo <owner>/<repo>`, because the app's token is minted for the repository of the working directory.

3. **Ensure the app.** In the repository's `path`, run `node ${CLAUDE_SKILL_DIR}/../pull-request/scripts/app-token.mts --login`. `${CLAUDE_SKILL_DIR}` is the folder of this file. Write it out in the command, because the shell does not know it. It prints the login of the user's GitHub App, such as `app/<slug>`. No output means no app is configured. Then stop and say that `~/.config/forge/github-app.json` with `clientId` and `privateKey` is missing. When it fails, the repository's line of step 8 quotes its error and the next release goes on. Never open a pull request under the user's login.
4. **Read what the merge starts.** The merge brings the workflows of `dev` to the default branch, so read them from `origin/dev`.

   ```sh
   git -C <path> ls-tree --name-only origin/dev .github/workflows/
   git -C <path> show origin/dev:.github/workflows/<file>
   ```

   A workflow runs on the merge when it triggers on `push` to the default branch, on `workflow_run` of such a workflow, or on a tag or a release such a workflow creates. Note what each one does to production, such as a deploy, a migration, an apply, a tag or a release, and link its runs as `https://github.com/<owner>/<repo>/actions/workflows/<file>`. A deploy outside GitHub Actions, such as a cloud build, reports as a check run on the merge commit. The check runs of the head of the default branch show which.

   ```sh
   gh api --paginate 'repos/<owner>/<repo>/commits/<default-branch>/check-runs?per_page=100' \
     --jq '.check_runs[] | select(.app.slug != "github-actions") | {name, app: .app.slug, details_url}'
   ```

   Link such a deploy to the page that lists its runs, such as the build history its `details_url` belongs to.
5. **Write the title and the body** in English. The body follows `.github/pull_request_template.md` of `origin/dev`, read with `git -C <path> show`, or the [template of the templates skill](../templates/assets/pull_request_template.md) when the repository has none. The headings stay as the template writes them, its comments are left out, and each section is filled as its comment says, with these rules for a release.
   - The title is a Conventional Commits subject `chore: release <what ships>` that names what changes for the user, such as `chore: release the yearly plan and the code-only sign-in`.
   - **Summary** opens with ``Ships `dev` to `<default-branch>`.`` and says what changes in production.
   - **Linked issue** holds `Closes #<n>` for each issue of this repository in `issues`, since GitHub closes an issue only once its pull request reaches the default branch. An issue of another repository gets `Refs <owner>/<repo>#<n>`, because the release of its own repository closes it. The section holds `None` when `issues` is empty.
   - **Scope** lists every pull request of `shipped` as `#<n> <title>`, the layers of one stack in one item.
   - **Blast radius** names every run of step 4 with its link, and who notices the change in production.
   - **Automated coverage** names the checks that ran on the shipped pull requests and run again on this one.
   - **Steps** hold only what production shows for the first time, such as a deploy that passes, a migration or an apply only production gets, a secret only production has, or an endpoint that answers after the deploy. Each run of step 4 that deploys, tags or releases gets a step with its link, such as the one below. A step that a shipped pull request already ran on `dev` or on its test stage is never repeated. When no step is left, Steps holds one sentence saying that the shipped pull requests ran their steps on `dev`.

     ```markdown
     - [ ] 1. Merge this pull request and open [Release (Production)](https://github.com/<owner>/<repo>/actions/workflows/production.yaml). The run of the merge commit passes. (needs a person: the merge changes production)
     ```

   - **Prerequisites** hold only what a step needs, and are left out otherwise.
   - **Notes for the reviewer** name each entry of `openSteps` as `step <k> of #<n>` with what it checks, read from that pull request. They also name the order to merge when the release of another repository of this run must land first, such as a database release before the app that needs it. The section is left out when empty.
   - **Diagram** and **Tradeoffs** are left out.
   - Automated coverage and Prerequisites put their content under the heading into `<details>` … `</details>`, with a one-line `<summary>` of the gist and a blank line after it. Code in the summary is `<code>`, not backticks.
   - Content comes only from the repository, the shipped pull requests, their issues and the conversation.
   - The person running the session is the author, so the body carries no line naming an AI and no session link.
   - An open release pull request is revised from what it says. Read its title and body first, then bring every section up to date with the release and keep what still holds, whoever wrote it.
6. **Open the pull request**, ready for review and without asking. The assignee and the reviewer are the user's login from `gh api user --jq .login`. Run it from the repository's `path` in one Bash call, with the app's token and the body from a quoted heredoc.

   ```sh
   cd <path> && GH_TOKEN="$(node ${CLAUDE_SKILL_DIR}/../pull-request/scripts/app-token.mts)" gh pr create \
     --repo <owner>/<repo> \
     --head dev \
     --base <default-branch> \
     --title "<title>" \
     --assignee <login> \
     --reviewer <login> \
     --body-file - <<'EOF'
   <body>
   EOF
   ```

   For an open `pullRequest`, write the title and the body back in place of creating one, and request the user's review when it lacks it. GitHub tells nobody about an edited description, so when the test plan changed, add a comment that names the steps that are new, changed or gone. Both run with the app's token too.

   ```sh
   cd <path> && GH_TOKEN="$(node ${CLAUDE_SKILL_DIR}/../pull-request/scripts/app-token.mts)" gh pr edit <number> \
     --repo <owner>/<repo> \
     --title "<title>" \
     --add-reviewer <login> \
     --body-file - <<'EOF'
   <body>
   EOF

   cd <path> && GH_TOKEN="$(node ${CLAUDE_SKILL_DIR}/../pull-request/scripts/app-token.mts)" gh pr comment <number> \
     --repo <owner>/<repo> \
     --body-file - <<'EOF'
   <changes to the test plan>
   EOF
   ```

   A failure without a URL may have left the pull request behind, so check `gh pr list --repo <owner>/<repo> --head dev --base <default-branch> --state open` before creating it again.
7. **Watch the checks.** Spawn one `forge:ci-watcher` agent per pull request, all in one message, each naming its URL, and wait for their reports. A failed check is fixed on `dev` through a pull request of its own, never on the release pull request, so step 8 only names it.
8. **Reply** in the language of the conversation, one line per release with its repository, the pull request's URL, whether it was opened or updated, and every failed check or the error of step 3. A repository the user named that has nothing to release gets a line with its reason. Then name the merge order when the notes name one. End by saying that the pull requests wait for the user's approval.
9. **After the merge.** When the user says that a release pull request is merged, reply with the link to each run its merge commit started and its result, from `gh run list --repo <owner>/<repo> --commit <full-sha> --json workflowName,status,conclusion,url` and from the check runs of step 4 on that commit.

Done when every repository of `releases` has a pull request from `dev` to its default branch, opened by the app with the user as assignee and reviewer, or the reply quotes why not, every body follows the template of its repository and the rules of step 5, its Linked issue closes every issue of its repository that `issues` names, its Steps hold no step a shipped pull request already ran and link every run that deploys, tags or releases, the checks were watched, and the reply holds one line per repository with its link.

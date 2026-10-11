---
name: templates
description: templates, the rules for the issue forms and the pull request template of a repository. Use whenever the issue or pull-request skill ensures its templates, or the user wants the templates of a repository installed or brought up to date.
disable-model-invocation: true
---

Rules for the templates GitHub reads from a repository, the issue forms in `.github/ISSUE_TEMPLATE/` and the pull request template `.github/pull_request_template.md`. They always come from this skill's assets. This skill writes them into the repository and overwrites every one that differs, without asking, so every repository runs on the current version. The `issue` skill runs it for the issue forms, the `pull-request` skill for the pull request template, and `/templates` for both.

## Assets

Each asset starts with a marker line that tells a reader the file is overwritten. A file is its asset, with the values the table names taken from the repository.

| Kind | Assets | Values from the repository |
| --- | --- | --- |
| Issue forms | [bug.yml](assets/ISSUE_TEMPLATE/bug.yml), [feature.yml](assets/ISSUE_TEMPLATE/feature.yml), [chore.yml](assets/ISSUE_TEMPLATE/chore.yml), [refactor.yml](assets/ISSUE_TEMPLATE/refactor.yml), [epic.yml](assets/ISSUE_TEMPLATE/epic.yml), [config.yml](assets/ISSUE_TEMPLATE/config.yml) | the `contact_links` of `config.yml`. If Discussions are enabled, link `https://github.com/<owner>/<repo>/discussions` with `about: Ask and answer questions here.` If a security policy is enabled, link `securityPolicyUrl` with `about: Report security vulnerabilities here, never as a public issue.` Otherwise the list stays empty. |
| Pull request template | [pull_request_template.md](assets/pull_request_template.md) | `<prerequisites>`, replaced by the block of every platform the repository ships, from [prerequisites/](../pull-request/assets/prerequisites/). `ios.md` for an app built with Xcode, `web.md` for an application in the browser, `api.md` for a service called over the network, `cli.md` for a command line tool or a library. Every value comes from the repository, such as the scheme from the Xcode project or the start command from `package.json`. A repository with several platforms gets one block per platform, each under its own `#### <platform>` heading. |

## Steps

1. **Read the repository.** When this skill runs as `/templates`, run `gh auth status` first and do nothing else until it reports a logged-in account. If `gh` is missing, install it after confirmation, following GitHub's [installation guide](https://raw.githubusercontent.com/cli/cli/trunk/README.md#installation). If nobody is logged in, ask the user to run `! gh auth login`, wait for them, then run `gh auth status` again. If the user declines, stop and say what is missing. Read the repository with `gh repo view --json nameWithOwner,defaultBranchRef,hasDiscussionsEnabled,isSecurityPolicyEnabled,securityPolicyUrl`. The kinds are the one the calling skill names, or both for `/templates`.
2. **Compare.** Build each file of the named kinds from its asset, as the table above says, and compare it with the file of the same path in the repository. A file that is missing or differs is outdated, whoever wrote it. Any other file in `.github/ISSUE_TEMPLATE/` is never changed.
3. **Pick the branch.** When nothing is outdated, skip to step 7. On the default branch, or on `dev` when the remote has it, write and commit on the branch `chore/templates`, created from it when it does not exist, otherwise checked out. Compare again on that branch, so the run writes only what it still lacks. On any other branch, write there.
4. **Write** every outdated file as step 2 built it. Another `pull_request_template.md`, in any letter case, in `.github/`, the root or `docs/` is removed with `git rm`, so the repository holds one template. For the issue forms, ensure the labels they set exist, with `gh label list --search "<name>" --json name` per label, matched on the exact name, and create each missing one.

   ```sh
   gh label create bug \
     --color d55e00 \
     --description "Indicates an unexpected problem or unintended behavior"

   gh label create feature \
     --color 009e73 \
     --description "Indicates a new feature or capability"

   gh label create chore \
     --color 0072b2 \
     --description "Indicates work without user-facing change"

   gh label create refactor \
     --color e69f00 \
     --description "Indicates a change to structure without a change in behaviour"

   gh label create epic \
     --color cc79a7 \
     --description "Groups sub-issues into one outcome"
   ```
5. **Commit** each kind on its own with the `commit` skill, one commit each, which needs no confirmation because it is one commit. Stage only the written files with `git add <file>` and commit only those paths. Files the user had staged before are not part of these commits. They stay staged, untouched, for the user to commit later. The templates belong to no issue, which answers the `commit` skill's question about one.
   - `chore: add issue templates` when the repository had no issue form, `chore: update issue templates` otherwise.
   - `chore: add pull request template` when the repository had no template, `chore: update pull request template` otherwise.
6. **Leave the branch.** When step 3 moved to `chore/templates` and the user asked only for templates, stay there and run the `pull-request` skill from its step 3, which opens its draft, so the templates reach the default branch. When step 3 moved and the user asked for more, switch back to the branch you came from.
7. **Reply** to the calling skill, which folds it into its own reply, or to the user for `/templates`. Name each written file and the branch of step 3 when it moved. Say that GitHub reads templates from the default branch only, so a write takes effect once its commit reaches it.

Done when every file of the named kinds equals its build from the asset, each written kind is its own commit, every other file in `.github/ISSUE_TEMPLATE/` is unchanged, and the reply names what was written and where.

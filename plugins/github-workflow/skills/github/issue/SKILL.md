---
name: issue
description: issue, the rules for every GitHub issue. Use whenever the user wants to create an issue, report a bug, request a feature, plan a task, set up issue templates, or when another skill needs an issue for the work at hand. Use it before every `gh issue create` you run, even when the user did not name the issue skill.
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/prefill-url.mts *)
---

Rules for every GitHub issue you create. This skill ensures templates exist, interviews the user where the request leaves the requirements open, then fills the template's fields and hands them to the user as a prefilled GitHub form, or creates the issue itself when another skill asked for it.

## Steps

1. **Ensure a user and `gh`.** Every step needs a user who can answer. Without one, stop. Run `gh auth status` and do nothing else until it reports a logged-in account whose token scopes include `project`. If `gh` is missing, install it after confirmation, following GitHub's [installation guide](https://raw.githubusercontent.com/cli/cli/trunk/README.md#installation). If nobody is logged in, ask the user to run `! gh auth login`, wait for them, then run `gh auth status` again. If the scope is missing, ask the user to run `! gh auth refresh -s project`. If the user declines, stop and say what is missing.
2. **Ensure the grilling skill.** Look for `grilling` under `.claude/skills/` of the repository or of the user. If it is missing, install it after confirmation, with the "Run a one-off tool" command from the `package-manager` skill.

   ```sh
   pnpx skills add https://github.com/mattpocock/skills --skill grilling
   ```
3. **Ensure templates.** Look for template files in `.github/ISSUE_TEMPLATE/` of the repository, where `config.yml` alone counts as none. If there are none, read the owner's public `.github` repository with `gh api repos/<owner>/.github/contents/.github/ISSUE_TEMPLATE`. Templates found in either place are used unchanged, never overwritten or added to. If neither place has any, install this skill's set after confirmation.
   - Copy [assets/bug_report.yml](assets/bug_report.yml), [assets/feature_request.yml](assets/feature_request.yml), [assets/chore.yml](assets/chore.yml), [assets/epic.yml](assets/epic.yml) and [assets/config.yml](assets/config.yml) into `.github/ISSUE_TEMPLATE/`.
   - Fill `contact_links` in `config.yml` only with targets that exist, read with `gh repo view --json hasDiscussionsEnabled,isSecurityPolicyEnabled,securityPolicyUrl`. If Discussions are enabled, link `https://github.com/<owner>/<repo>/discussions` with `about: Ask and answer questions here.` If a security policy is enabled, link `securityPolicyUrl` with `about: Report security vulnerabilities here, never as a public issue.` Otherwise leave the list empty.
   - Ensure the four labels the forms set, as in step 4.
   - Stage the files with `git add .github/ISSUE_TEMPLATE` and commit only that path with the `commit` skill as its own commit, `chore: add issue templates`, after confirmation. Files the user had staged before are not part of this commit. They stay staged, untouched, for the user to commit later. The templates belong to no issue, which answers the `commit` skill's question about one. Say that GitHub reads templates from the default branch only, so they take effect once the commit reaches it.
   - If the user asked only for templates, this is the end.
4. **Pick the template.** Bug when something behaves differently than expected, feature when the user wants something new or changed, chore for work with no user-facing change, epic when the user asks for one or the request has several parts that ship on their own. Ensure the labels the chosen template sets exist, with `gh label list --search "<name>" --json name` per label, matched on the exact name, and create each missing one.

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

   gh label create epic \
     --color cc79a7 \
     --description "Groups sub-issues into one outcome"
   ```

   The issue is written in English, whatever language the existing issues use.
5. **Interview.** One runs when the request leaves a field of the template open, so almost always for a feature or epic, whose criteria and out-of-scope list come from the user, rarely for a chore, never for a bug. When it runs, run the `grilling` skill on the request before writing anything. Put every round to the user with the AskUserQuestion tool, one entry per question with its choices as the options and the recommended answer first, marked "(Recommended)". A round with more than four questions takes several calls.
6. **Write the draft.** Search for duplicates first with `gh issue list --search "<keywords>" --state all`. If one matches, show it and stop. Then write the title in one sentence and one value per field of the template, in template order, each filled the way its `description` says. Required fields are never empty, empty optional fields are left out.
   - Content comes only from the request, the interview, the code and the conversation. What none of them settles is asked, never guessed. One goal per issue.
   - The body carries decisions, the interview comment of step 8 carries the reasoning. Each settled point is one line that states what was decided.
   - Point instead of paste. Files as `path:line`, documentation as URLs, commits as SHAs. Whatever the implementer can read at the pointer stays there. The one quotation is a bug's error output, in a code block, trimmed to the lines that matter.
   - An issue that changes a flow or a structure, however small the change is, shows the change as a diagram, the planned state of the `diagrams` skill, at the end of the field that describes the solution. The diagram replaces the sentences that would retell it.
   - When a third-party library or API is involved and no source is named, find its official documentation yourself and add it to the sources field.
   - Cut pass, once the fields are written. Reread the draft and delete every sentence whose removal changes neither what the implementer does nor how done is judged.
   - Every metadata field is decided, none is left open. Label from the template. Assignee and milestone from the request or the interview, the choices read with `gh api repos/<owner>/<repo>/milestones`. Parent, blocked-by and blocking from the request or the interview. Type in an organization, from `gh api orgs/<owner>/issue-types`.
   - App labels. In a repository that holds several applications or packages, such as the workspaces of its package manager or the folders under `apps/` and `packages/`, the issue carries one `app: <name>` label per application or package it touches, named after its folder, so the `today-issues` skill can run issues of different applications side by side. Which ones it touches comes from the request, the interview and the code. A label the repository lacks is created after confirmation.

     ```sh
     gh label create "app: <name>" \
       --color 56b4e9 \
       --description "Touches <path>"
     ```
   - Project. Every issue belongs to a project, from the request or the interview, chosen among `gh project list --owner <owner> --format json`. A single project is the choice without a question. An owner without a project, or a chosen project without Priority or Size in its field list, gets them from the `project` skill first, which creates or extends the project after confirmation and returns the project number. The single-select fields of the project that describe the work, read with `gh project field-list <number> --owner <owner> --format json`, are yours to decide from the request and the interview, size by the number of acceptance criteria and the areas they touch, priority by how many users the problem hits and how often. Status is workflow state and stays with the project.
   - The epic form is the parent, created first. Then steps 6 to 8 run once per part, from its own template, with the epic as the parent and the epic's interview as the source of answers, without a second interview.
7. **Present.** Ask for each metadata field still open first. A field stays empty only when the user says so. The project is never left empty. Then the route depends on who invoked this skill.
   - **Form, when the user did.** GitHub's form is the review, so build the prefill URL with [scripts/prefill-url.mts](scripts/prefill-url.mts), with Node 24 or newer, which runs TypeScript directly, and open it in the browser, `open "<url>"` on macOS and `xdg-open "<url>"` on Linux. The script refuses a URL above GitHub's limit and names the bytes to cut. Take the diagram out of its field first, which step 8 then posts as a comment, otherwise shorten the values from step 6, and run it again. Parent, blocked-by, blocking, type and the project with its fields have no parameter, so step 8 sets them, together with the app labels.

     ```sh
     node ${CLAUDE_SKILL_DIR}/scripts/prefill-url.mts <<'EOF'
     {
       "repo": "<owner>/<repo>",
       "template": "<file>.yml",
       "title": "<title>",
       "fields": {"<id>": "<value>"},
       "assignees": ["<login>"],
       "milestone": "<title>"
     }
     EOF
     ```

     Then ask with the AskUserQuestion tool and wait. The question says the form is open in the browser and names the fields step 8 sets. The user types the issue number or URL, the one option is changes to the draft. Changes go back to step 6 and end in a new form, until the user answers with the number.
   - **Draft, when another skill did.** Show the title, the body as the Markdown GitHub would produce from the submitted form, each `label` as a `###` heading and `markdown` elements left out, and every metadata field with its value. Then wait for the user to confirm.
8. **Create.**
   - **Form.** Confirm the issue with `gh issue view <number> --json title,url`, then set the fields the URL could not carry.

     ```sh
     gh issue edit <number> \
       --add-label "app: <name>" \
       --parent <parent> \
       --add-blocked-by <blocker> \
       --add-blocking <blocked> \
       --type "<name>"
     ```
   - **Draft.** The body from a quoted heredoc, every metadata field from step 7 as its flag. Show the URL `gh` prints.

     ```sh
     gh issue create \
       --title "<title>" \
       --label <label> \
       --label "app: <name>" \
       --assignee <login> \
       --milestone "<title>" \
       --parent <number> \
       --blocked-by <number> \
       --blocking <number> \
       --type "<name>" \
       --body-file - <<'EOF'
     <body>
     EOF
     ```

     A failure without a URL may have left the issue behind, so check `gh issue list --search "<title>" --state all` before creating again, and finish the missing flags with `gh issue edit`.

   On both routes, add the issue to its project, which prints the item id, then set every decided field, the ids from the project list and the field list.

   ```sh
   gh project item-add <number> --owner <owner> --url <url> --format json

   gh project item-edit \
     --project-id <project-id> \
     --id <item-id> \
     --field-id <field-id> \
     --single-select-option-id <option-id>
   ```

   Then, if an interview ran, post it as the first comment with `gh issue comment <number> --body-file -`, wrapped in `<details><summary>Requirements interview</summary>` and `</details>`, one Markdown block per question with the recommendation and the answer.

   Then, if step 7 took the diagram out of its field, post it as a comment of its own with `gh issue comment <number> --body-file -`, the diagram with its legend and its consequences as the `diagrams` skill writes them.

Done when the issue exists on GitHub with every required field of its template filled, every metadata field set or left empty by the user's word, the issue in its project with every field set, the interview attached as its first comment when one ran, and the diagram of a changed flow or structure in its body or in a comment.

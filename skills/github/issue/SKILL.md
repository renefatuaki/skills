---
name: issue
description: issue, the rules for every GitHub issue. Use whenever the user wants to create an issue, report a bug, request a feature, plan a task, set up issue templates, or when another skill needs an issue for the work at hand. Use it before every `gh issue create` you run, even when the user did not name the issue skill.
---

Rules for every GitHub issue you create. This skill ensures templates exist, interviews the user where the request leaves the requirements open, then fills the template's fields, creates the issue and asks the user to review it on GitHub.

## Steps

1. **Ensure a user and `gh`.** Every step needs a user who can answer. Without one, stop. Run `gh auth status` and do nothing else until it reports a logged-in account whose token scopes include `project`. If `gh` is missing, install it after confirmation, following GitHub's [installation guide](https://raw.githubusercontent.com/cli/cli/trunk/README.md#installation). If nobody is logged in, ask the user to run `! gh auth login`, wait for them, then run `gh auth status` again. If the scope is missing, ask the user to run `! gh auth refresh -s project`. If the user declines, stop and say what is missing.
2. **Ensure the grilling skill.** Look for `grilling` in the skill list of the session, under its own name or with a plugin prefix such as `mattpocock-skills:grilling`. If it is missing, install it globally after confirmation, with the "Run a one-off tool" command from the `package-manager` skill. `-g` installs for the user, so every repository finds it.

   ```sh
   pnpx skills add https://github.com/mattpocock/skills --skill grilling -g
   ```
3. **Ensure templates.** Read [templates](../templates/SKILL.md) and follow it for the issue forms. Its reply folds into this skill's reply. If the user asked only for templates, this is the end. Steps 4 to 7 read the forms from the assets of the templates skill.
4. **Pick the template.** Bug when something behaves differently than expected, feature when the user wants something new or changed, refactor for a change to structure that keeps the behaviour, chore for other work with no user-facing change, epic when the user asks for one or the request has several parts that ship on their own. Ensure the labels the chosen template sets exist, with `gh label list --search "<name>" --json name` per label, matched on the exact name, and create each missing one.

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

   The issue is written in English, whatever language the existing issues use.
5. **Interview.** One runs when the request leaves a field of the template open, so almost always for a feature or epic, whose criteria and out-of-scope list come from the user, rarely for a chore or a refactor, never for a bug. When it runs, run the `grilling` skill on the request before writing anything. Put every round to the user with the AskUserQuestion tool, one entry per question with its choices as the options and the recommended answer first, marked "(Recommended)". A round with more than four questions takes several calls.
6. **Write the draft.** Search for duplicates first with `gh issue list --search "<keywords>" --state all`. If one matches, show it and stop. Then write the title in one sentence and one value per field of the template, in template order, each filled the way its `description` says. Required fields are never empty, empty optional fields are left out.
   - Content comes only from the request, the interview, the code and the conversation. What none of them settles is asked, never guessed. One goal per issue.
   - The body carries decisions, the interview comment of step 7 carries the reasoning. Each settled point is one line that states what was decided.
   - Every item under Acceptance criteria, Done when and Success criteria is a checkbox, `- [ ]`, one criterion each. A Given/When/Then goes inside its item.
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
   - Repo labels. When the project holds issues of several repositories, the issue carries one `repo: <name>` label for the repository its code changes land in, which can differ from the repository it sits in, so the `today-issues` skill and the Ticket playbook of the engineering skill run it there. The label's description names that repository. Work that changes several repositories becomes an epic with one sub-issue per repository, each blocked by the one whose change it needs. A label the repository lacks is created after confirmation.

     ```sh
     gh label create "repo: <name>" \
       --color e69f00 \
       --description "Affects <repository>"
     ```
   - Project. Every issue belongs to a project, from the request or the interview, chosen among `gh project list --owner <owner> --format json`. A single project is the choice without a question. An owner without a project, or a chosen project without Priority or Size in its field list, gets them first from [project](../project/SKILL.md), read and followed, which creates or extends the project after confirmation and returns the project number. The single-select fields of the project that describe the work, read with `gh project field-list <number> --owner <owner> --format json`, are yours to decide from the request and the interview, size by the number of acceptance criteria and the areas they touch, priority by how many users the problem hits and how often. Status is workflow state and stays with the project.
   - The epic form is the parent, created first. Then steps 6 and 7 run once per part, from its own template, with the epic as the parent and the epic's interview as the source of answers, without a second interview. A part that builds on another is blocked by it, so the Ticket playbook of the engineering skill stacks its pull request on that part's.
7. **Create.** The body is the Markdown GitHub would produce from the submitted form, each `label` as a `###` heading and `markdown` elements left out, from a quoted heredoc, every decided metadata field as its flag.

   ```sh
   gh issue create \
     --title "<title>" \
     --label <label> \
     --label "app: <name>" \
     --label "repo: <name>" \
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

   Add the issue to its project, which prints the item id, then set every decided field, the ids from the project list and the field list.

   ```sh
   gh project item-add <number> --owner <owner> --url <url> --format json

   gh project item-edit \
     --project-id <project-id> \
     --id <item-id> \
     --field-id <field-id> \
     --single-select-option-id <option-id>
   ```

   Then, if an interview ran, post it as the first comment with `gh issue comment <number> --body-file -`, wrapped in `<details><summary>Requirements interview</summary>` and `</details>`, one Markdown block per question with the recommendation and the answer.
8. **Review.** Ask with the AskUserQuestion tool and wait. The dialog hides the chat, so the question holds the issue's link, `https://github.com/<owner>/<repo>/issues/<number>`, and asks whether anything should change. Every metadata field still open is a question of its own in the same call, the link in each. A field stays empty only when the user says so. The project is never left empty. Changes go back to step 6 and land on the existing issue with `gh issue edit` and `gh project item-edit`, then this step asks again, until the user has nothing to change. An epic asks once, after its parts exist, with every link.

Done when the issue exists on GitHub with every required field of its template filled, every metadata field set or left empty by the user's word, the issue in its project with every field set, the interview attached as its first comment when one ran, the diagram of a changed flow or structure in its body, and the user has nothing left to change.

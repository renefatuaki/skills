---
name: project
description: project, the rules for every GitHub Project. Use whenever the user wants to create a project, bring one in line with the field set, or when another skill needs a project with Priority and Size. Use it before every `gh project create` you run, even when the user did not name the project skill.
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/sync-project.mts *)
---

Rules for every GitHub Project you create. A project carries the Status, Priority and Size fields of [assets/project.json](assets/project.json), so the `issue` skill can set priority and size on every issue, and it is linked to the repository. A project lives under the account or the organization, never in the repository, so every write below runs after confirmation.

## Steps

1. **Ensure a user and `gh`.** Every step needs a user who can answer. Without one, stop. Run `gh auth status` and do nothing else until it reports a logged-in account whose token scopes include `project`. If `gh` is missing, install it after confirmation, following GitHub's [installation guide](https://raw.githubusercontent.com/cli/cli/trunk/README.md#installation). If nobody is logged in, ask the user to run `! gh auth login`, wait for them, then run `gh auth status` again. If the scope is missing, ask the user to run `! gh auth refresh -s project`. If the user declines, stop and say what is missing.
2. **Read the owner.** `gh repo view --json owner,nameWithOwner` gives the owner login and the `<owner>/<repo>` for the title and the link. When the caller or the user named a project, read its fields with `gh project field-list <number> --owner <owner> --format json`.
3. **Pick the path** and confirm it, the owner and the title with the AskUserQuestion tool. The title is the repository name when the request names none.
   - **Extend**, when a project was named.
   - **Create**, otherwise.
4. **Create.** On Create only. The output carries the number.

   ```sh
   gh project create --owner <owner> --title "<title>" --format json
   ```
5. **Ensure the fields.** Priority and Size, each unless the project has it. Status comes with every project.

   ```sh
   gh project field-create <number> --owner <owner> \
     --name Priority \
     --data-type SINGLE_SELECT \
     --single-select-options Critical,High,Medium,Low

   gh project field-create <number> --owner <owner> \
     --name Size \
     --data-type SINGLE_SELECT \
     --single-select-options XS,S,M,L,XL
   ```
6. **Apply the field set.** Run [scripts/sync-project.mts](scripts/sync-project.mts), on Create and on Extend alike, with Node 24 or newer, which runs TypeScript directly. It sets the names, colors and descriptions of Status, Priority and Size from the asset and keeps the value of every item whose option exists under the asset's name. When a field has options beyond the asset, it lists them and stops, because dropping them strips the value from their items, so put the list to the user and run again with `--drop` only on their word.

   ```sh
   node ${CLAUDE_SKILL_DIR}/scripts/sync-project.mts <number> --owner <owner>
   ```
7. **Link.** On Create and on Extend alike.

   ```sh
   gh project link <number> --owner <owner> --repo <owner>/<repo>
   ```
8. **Hand over.** Reply with the project number and the URL, so the calling skill continues with `gh project item-add`. Then list what the API cannot set and the user does in the browser, under the project's settings for workflows and in its toolbar for views. Workflows are auto-add, the sub-issue automation and item closed to Done. Views are the six below.

   | View | Layout | Group by | Sort | Filter |
   |---|---|---|---|---|
   | Backlog | Board | Status as columns | Priority ascending, then Size descending | |
   | Priority board | Board | Priority, Status as columns | | |
   | Team items | Table | Status | | |
   | Roadmap | Roadmap | | | |
   | In review | Table | | | `status:"In review"` |
   | My items | Table | | | `assignee:@me` |

Done when the project exists under the owner with Status, Priority and Size carrying every option of the asset, is linked to the repository, the reply names its number, and the user holds the list of settings that stay manual.

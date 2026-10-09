---
name: today-issues
description: today-issues, the plan for today's tickets of a GitHub Project. Use whenever the user asks what to work on today, which ticket comes next, or which tickets can run in parallel.
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/read-board.mts *)
---

The plan for one day of work on a GitHub Project. This skill reads the open tickets of the board, asks the user for today's three budgets, ranks the tickets, groups them into tracks that run side by side, and shows one table per track in the format of [assets/plan.md](assets/plan.md). It only reads. The board is the state, so every run plans from what the board says now.

## Steps

1. **Ensure a user and `gh`.** Every step needs a user who can answer. Without one, stop. Run `gh auth status` and do nothing else until it reports a logged-in account whose token scopes include `project`. If `gh` is missing, install it after confirmation, following GitHub's [installation guide](https://raw.githubusercontent.com/cli/cli/trunk/README.md#installation). If nobody is logged in, ask the user to run `! gh auth login`, wait for them, then run `gh auth status` again. If the scope is missing, ask the user to run `! gh auth refresh -s project`. If the user declines, stop and say what is missing.
2. **Read the board.** The owner comes from `gh repo view --json owner`. The project is the one the user named, otherwise chosen among `gh project list --owner <owner> --format json`. A single project is the choice without a question, several go to the user with the AskUserQuestion tool. An owner without a project ends the run, with the hint that the `project` skill creates one. Then run [scripts/read-board.mts](scripts/read-board.mts), with Node 24 or newer, which runs TypeScript directly.

   ```sh
   node ${CLAUDE_SKILL_DIR}/scripts/read-board.mts <number> --owner <owner>
   ```

   It prints every open issue of the project that is not Done and is assigned to the user or to nobody, from every repository the project holds. `blockedBy` holds open blockers only, and `pullRequests` the open pull requests that close the issue.
3. **Pick the candidates.** Every issue without sub-issues is a ticket, and its Status decides whether it is a candidate.
   - A ticket In review, In progress or Ready is a candidate.
   - A Backlog ticket is a candidate only when no ticket on the whole board is Ready. A ticket without a Status counts as Backlog.
   - A Blocked ticket is never a candidate.

   A candidate leaves the plan for the Not today list when one of its open blockers is no candidate. The blockers of a ticket are the issues in `blockedBy`, whatever its body says.

   An issue with sub-issues is an **epic**, whatever its label, and its sub-issues are the issues whose `parent.url` is its URL. An epic is never planned itself. Its sub-issues are, each by its own Status like any other ticket, and they decide what happens to the epic.
   - An epic with a candidate sub-issue is planned through its candidates. It has **begun** when one of its sub-issues is closed, which `subIssues.completed` counts, or is In progress or In review.
   - An epic with open sub-issues and no candidate among them waits, and the plan leaves it out.
   - An epic whose sub-issues are all closed, where `subIssues.completed` equals `subIssues.total`, is **finished**. The plan names it under Gaps as ready to be closed.
4. **Ask the budgets.** Read the time with `date` and tell the user the time and how many candidates wait. Then ask all three budgets in one call of the AskUserQuestion tool, each as a duration. The time shapes the options you offer, so a late start gets shorter ones. The answers alone are the budgets.
   - **Total.** How long sessions may run today.
   - **Questions.** How long the user answers the questions of running sessions.
   - **Review.** How long the user reviews pull requests.
5. **Estimate every candidate.** Its Size gives three values.

   | Size | Run | Questions | Review |
   |---|---|---|---|
   | XS | 15 min | 5 min | 5 min |
   | S | 30 min | 5 min | 10 min |
   | M | 1 h | 10 min | 20 min |
   | L | 2 h | 20 min | 40 min |
   | XL | 4 h | 40 min | 1 h 20 min |

   Then read the body of each candidate with `gh issue view <number> --repo <repository> --json body`. The values of the table are the start, and the body changes them in three cases. Each change and its cause go into the Reason of the ticket, the last column of its row in the plan.
   - Open decisions raise the questions.
   - Checked acceptance criteria and work already merged shorten the run and the review.
   - Work only the user can do, such as an account or a store listing, counts as questions and not as run.

   Two kinds of ticket get their values another way.
   - A ticket without a Size gets all three values from its body.
   - A ticket In review costs review and nothing else. That is the review of its open pull request, when it has one, and everything its body leaves for the user to do.
6. **Rank.** The ranking orders units. A candidate that belongs to no epic is a unit of its own. An epic with its candidate sub-issues is one unit, so they stay together. The rules apply in order, and a rule decides only between units that every rule before it ranks the same.
   1. In review, because a review releases finished work.
   2. Priority Critical.
   3. In progress.
   4. An epic that has begun.
   5. The order an application is built in. A blocker comes before what it blocks. Then the layer, read from the title, the labels and the body. Foundation and setup, data model, backend, API, user interface, polish. Work on no layer, such as tooling or research, comes last.
   6. Priority, the highest first. A ticket without a Priority counts as Medium.
   7. Size, the smallest first, so short tickets finish in a row.
   8. The issue number, the lowest first.

   The candidate sub-issues of an epic follow rules 5 to 8 among themselves. The epic ranks with its own Priority and with the layer and the Size of the first of them.
7. **Build the tracks.** A track is a row of tickets that run one after another. Tracks run side by side.
   - Two tickets collide when they belong to the same repository, unless both carry `app: <name>` labels and name no common application.
   - Tickets that collide share a track, in rank order. A ticket that collides with tickets of several tracks joins those tracks into one. A ticket and its blocker share a track too. The ticket starts once the pull request of its blocker is merged, and its Reason says so.
   - An epic is a track of its own that holds its sub-issues and nothing else, and it runs alone. It starts when every ticket ranked before it has ended, and no ticket ranked after it starts before its last candidate sub-issue has ended.
   - Tickets In review form no track. They are the Reviews table, and nothing waits for them.
8. **Fill the budgets.** Walk the units in rank order and place each ticket that keeps all three sums within their budgets. A sum that meets its budget exactly is within it. A ticket joins its track when it is placed, so a ticket that goes to Not today joins no tracks.
   - Total bounds the run of every track, the tracks it waits for included.
   - Questions bounds the sum over every placed ticket.
   - Review bounds the sum over every placed ticket and every review.
   - A ticket that exceeds a budget goes to Not today with the name of that budget, and the walk goes on with the next unit.
   - An epic takes its candidate sub-issues in order. When all of them are placed, the walk goes on with the next unit. When the first of them exceeds a budget, the epic does not start today, all of them go to Not today with the name of that budget, and the walk goes on as well. When a later one exceeds a budget, the epic has started and stops there. Its candidate sub-issues left go to Not today as continuing on another day, and so does every unit ranked after the epic.
9. **Show the plan** as the reply, in the format of [assets/plan.md](assets/plan.md) and in English. The Reason of a ticket names the rule that put it where it stands. Gaps name every candidate without a Size or a Priority, every candidate without an `app: <name>` label whose repository holds another ticket that carries one, and every finished epic.

Done when every candidate stands in a table or under Not today with its reason, every Blocked ticket stands under Not today, the planned sums stand against the three budgets, and every gap is named.

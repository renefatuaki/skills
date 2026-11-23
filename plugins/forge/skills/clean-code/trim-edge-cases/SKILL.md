---
name: trim-edge-cases
description: trim-edge-cases, removes the cases that never occur in normal use from every function a diff touches, together with their tests. Use whenever the user wants to trim, prune or remove edge cases, defensive code, needless guards, fallbacks or retries, says that code handles things that cannot happen, or when the Ticket playbook or Opening a PR reaches its trim step.
argument-hint: "[base]"
---

Removes guards, fallbacks, retries, dead branches and error cases that do not occur in normal use, in every function the diff touches, together with their tests. The removal stands apart from the change, as a `refactor` commit of its own.

Code handles a case only when it occurs in normal use. A case occurs in normal use when a caller passes the value, a system boundary (network, file, user input) lets it in, an acceptance criterion asks for it, or an observed bug shows it. A rare race, a coincidence of several actors or the leftovers of a run that stopped halfway do not count, unless an acceptance criterion or an observed bug names them.

## Steps

1. **Fence off the change.** Run this skill last, after every other change to the diff. Stage every open file of the change by name, new files included, until `git status --porcelain` shows no unstaged change. From here on the working tree holds only the removal.
2. **Read the diff.** The diff is the one the calling skill named, otherwise `git diff origin/<base>...HEAD` together with the stage. The base is the branch the user named, otherwise `dev` when the remote has it and the current branch is another one. A remote without `dev` that the repository still names, in a workflow trigger on `dev`, a dependabot `target-branch`, its `CLAUDE.md` or `AGENTS.md`, or the base of its recent pull requests, stops the run. Report the missing `dev` and never fall back to the default branch. Otherwise the default branch. List every function the diff touches.
3. **List the cases.** In each of these functions, list every guard, fallback, retry, dead branch and error case with its file and line.
4. **Have the judge decide.** One fresh subagent judges the whole list, `subagent_type: "forge:engineer"` with the `edge-case judge` role, `fable/xhigh` by default, resolved per `${CLAUDE_PLUGIN_ROOT}/skills/workflow/engineering/references/model-roles.md`. Its brief holds the rule above, the list, the diff and the issue with its acceptance criteria. It changes no file. For each case it reads the callers, the boundary the value crosses and the commit that added it, which `git log -S` finds, for a bug it fixed. It answers keep or remove, each with one sentence of reason. A case stays when it occurs in normal use, or when the judge cannot read all its callers, such as behind a published API. A case that stays gets no comment and no note.
5. **Remove the rest.** Delete every case the judge marked remove, its tests, and each helper, type, error and parameter that only it used. A wrapper, a layer or an interface is no case and stays, [minimize-reader-load](../../principles/minimize-reader-load/SKILL.md) judges those.
6. **Prove it.** Run the build and the tests. A red test of a case you kept shows that a case you removed occurs in normal use, so put that one back.
7. **Hand over the removal on its own.** A run that removed nothing hands over only the change. Otherwise the first case that matches applies.
   - The task commits. Commit the stage with the `commit` skill, then stage the removal and commit it as `refactor: trim edge cases in <area>`, with the trailers the calling skill names, otherwise the issue of the change, in its footer. Its body names each removed case in one line.
   - Nobody asked for a commit. Leave the change staged and the removal unstaged, and name both in the reply.

Done when no function the diff touches handles or tests a case that does not occur in normal use, the build and the tests are green, and the removal stands apart from the change as its own `refactor` commit or the only unstaged change.

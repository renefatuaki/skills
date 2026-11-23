---
"forge": patch
---

A command that a permission rule or auto mode denies now ends in one ready line for the user. In about 16 sessions the force push of `tidy-history` and of a stack rebase, an `rm -rf` of the worktree cleanup and a cleanup chained with `git branch -D` were denied, the agent retried variants, and the user typed the command by hand. `tidy-history`, `pull-request` and the Ticket and Worktree cleanup playbooks now never retry a denied command, and open the reply with one `! <command>` line that covers every branch and path at once. The worktree cleanup no longer runs `rm -rf` and hands a leftover directory to the user. The Ticket playbook removes a worktree with a command of its own and deletes its branch only once `gh pr view` shows the pull request as merged. A new test fails when the text of a skill runs `rm -rf`.

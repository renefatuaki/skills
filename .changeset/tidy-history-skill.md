---
"forge": minor
---

The new `tidy-history` skill folds the commits of the current branch into one commit per change, for the worktree the session runs in. It rebuilds the branch with the `commit` skill, proves the tree unchanged and pushes a branch that is on the remote with `--force-with-lease`. It stops when a person has reviewed the pull request, unless the user asks for the tidy anyway, when the remote holds commits the branch lacks, or when layers of a stack build on the branch. The `pull-request` skill now runs it before every push.

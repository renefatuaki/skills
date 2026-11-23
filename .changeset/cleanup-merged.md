---
"forge": minor
---

A new `cleanup-merged` skill cleans up after merged pull requests. In 29 sessions the user typed by hand which pull request merged and asked to remove its worktree and branch and to close its ticket, because a `Closes` keyword does not fire on `dev`. `/cleanup-merged` now finds the user's merged pull requests by itself, in the current repository or in every repository of a workspace. It ticks the criteria their test plans proved, closes their issues and the epics those finish and sets them to Done. One script removes their worktrees and their branches, locally and on GitHub, and fast-forwards the main checkout. It keeps a worktree with uncommitted changes to tracked files and a branch with commits the pull request does not hold, and hands the user one `! rm -rf` line for a folder git could not delete.

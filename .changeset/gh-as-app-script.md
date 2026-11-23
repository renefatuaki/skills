---
"forge": patch
---

A pull request is now opened as the user's GitHub App through one script that a session in a worktree can run. The `GH_TOKEN="$(node …/app-token.mts)" gh pr create` form of the `pull-request` and `pull-request-review` skills was refused by Claude Code's guard in a worktree, and agents worked around it with ad-hoc scripts that the author hook never saw. The new `gh-as-app.mts` of the `pull-request` skill creates the app's token for the repository of the current directory or a `--repo` argument, runs `gh` with it, passes stdin, stdout, stderr and the exit code through and runs plain `gh` when no app is configured. Both skills list it in `allowed-tools` and call it in place of the inline form, and the author hook names it in its denial.

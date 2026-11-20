---
"forge": patch
---

A pull request is now always opened by the user's GitHub App. Twice a session ran `gh pr create` without loading the `pull-request` skill, so the pull request carried the user as its author and the user could not approve it. A new PreToolUse hook denies a `gh pr create` that no `GH_TOKEN` assignment precedes when `~/.config/forge/github-app.json` exists, and names the command that opens it as the app.

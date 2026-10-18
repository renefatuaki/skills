---
"forge": minor
---

A GitHub App of the user can open the pull requests, so the user can approve them and GitHub shows which ones wait for their review. `app-token.mts` of the `pull-request` skill reads `~/.config/forge/github-app.json`, signs a JSON Web Token with the app's private key and prints an installation token of the current repository, or with `--login` the login gh shows for the app. Without the file it prints nothing and every command runs as the user. With the app, the `pull-request` skill creates, edits, comments on and marks the pull request ready with its token, assigns the user, adds the projects under the user's login and requests the user as the reviewer when nobody else was named. `pull-request-review` posts its review on the app's pull request as a comment of the app. The worktree audit of the `engineering` skill lists the pull requests of every author. The GitHub workflow guide describes how to create the app.

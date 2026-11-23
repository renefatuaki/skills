---
"forge": patch
---

The `pull-request` and `pull-request-review` skills no longer hand the user a test step the agent can run itself. Sessions marked a step `(needs a person: …)` for a key that sat in the project's `.env`, a password in the Keychain, a sign-in by one-time code and a small paid API call, and the user had to ask for each of them to be run. A key or a credential in the repository's `.env` files, the Keychain or a test project, a test account the agent signs in to through an admin API, a one-time code or a magic link it reads itself, and a small paid call on a key the project already uses now never make a step need a person. A step left to a person ends with `(tried: <what the agent tried>) (needs a person: <reason>)`, and the check of the `pull-request` skill reports every unticked step that lacks either part.

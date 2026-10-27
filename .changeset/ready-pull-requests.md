---
"forge": minor
---

The `pull-request` skill opens every pull request ready for review, never as a draft. The user's GitHub App always opens it, with the user requested as reviewer, so the user can approve it. Without a configured app the skill stops and names what is missing. The issue moves to In Review when the pull request opens. Checks and the agent's own test steps still run afterwards, and the reply names what failed. The history is tidied before every push until a person has reviewed the pull request.

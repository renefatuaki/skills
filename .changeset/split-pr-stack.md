---
"forge": minor
---

The `pull-request` skill now opens a new branch with two or more changes as a stack of pull requests, one per change, in place of one large pull request. It tidies the history first with `tidy-history`, so each commit is one change. Then it gives each commit below the top its own branch `<branch>-<k>`, and the branch itself stays the top layer. Each layer gets its own title, description and test plan for its own commits. Each layer also gets its own checks and test steps. The `gh stack` extension links the layers on GitHub. A diagram update does not count as a change and goes into the top layer. Only the top pull request closes the issue. The layers below refer to it with `Refs`. The skill never splits a branch that already has an open pull request. The Ticket playbook resumes on the branch without the `-<k>` suffix.

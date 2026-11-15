---
"forge": minor
---

A new branch with two or more changes now opens as a stack of pull requests, one per change, in place of one large pull request. The `pull-request` skill tidies the history first with `tidy-history`, so each commit is one change, and then gives each commit below the top its own branch `<branch>-<k>`. The branch itself stays the top layer. Each layer gets its own title, description and test plan for its own commits, its own checks and test steps, and the `gh stack` extension links the layers on GitHub. A diagram update does not count as a change and joins the top layer. Only the top pull request closes the issue, the layers below refer to it. A branch with an open pull request is never split. The Ticket playbook resumes on the branch without the `-<k>` suffix.

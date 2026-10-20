---
"forge": minor
---

The `pull-request` skill tidies the history of a draft before every push. A reviewer now reads one commit per change, and a fix from a review or a check, a revert, a format pass or work in progress folds into the commit it finishes. The skill rebuilds the branch with the `commit` skill, proves the tree unchanged, and pushes a draft that is already on the remote with `--force-with-lease`. A pull request that is ready for review keeps its history.

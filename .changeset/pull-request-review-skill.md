---
"renefatuaki-skills": minor
---

Add the pull-request-review skill. It checks out a pull request, in a worktree when the working tree has changes, runs the steps of its test plan that it can drive itself and hands the rest to the reviewer in one message, then posts the result from a review template with the verdict, a row per step, a finding per failed or blocked step and the evidence of its own steps. A bundled script ticks the passed steps in the description and clears the marks of an earlier run. On the author's machine the steps of a requested reviewer stay open for them. A failed step waits for the reviewer's confirmation and becomes a request for changes, and the approval always stays the reviewer's own click.

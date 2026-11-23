---
"forge": patch
---

A pull request base no longer falls back to the default branch when the remote has lost its `dev`. A session ran `gh pr create --base main` after `dev` had been deleted on the remote, and the pull request had to be retargeted. The `pull-request`, `tidy-history` and `trim-edge-cases` skills and the `ticket-base` script now stop and report the missing `dev` when a workflow trigger, a dependabot `target-branch`, `CLAUDE.md`, `AGENTS.md` or the base of a recent pull request still names it.

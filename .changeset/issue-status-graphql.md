---
"forge": patch
---

The `github-issue-status.mts` script of the engineering skill reads the project items of an issue through GraphQL, because `gh issue view --json projectItems` returns neither item id nor project id and made the script crash.

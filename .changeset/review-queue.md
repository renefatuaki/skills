---
"forge": minor
---

The `review-queue` skill shows the open pull requests of the repository of the current directory as one Markdown table in the order to review them, with the columns `#`, `Pull request`, `After` and `Status`. Each pull request links to GitHub. A pull request comes after the one its base branch is the head branch of, and after the one that closes an issue blocking one of its own closing issues. `After` names the one it waits on. Each stack is listed in one piece, depth first, and of two children the one with fewer pull requests after it comes first. Stacks among themselves go ready before draft, then the oldest. The reply is the table alone.

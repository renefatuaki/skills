---
"forge": major
---

Add the issue skill. It runs the templates skill for the issue forms, picks the bug, feature, refactor, chore or epic form, creates the labels they set and interviews the user with grilling, installed globally when it is missing, when the request leaves a field open. It opens the form prefilled in the browser through a URL that a bundled script builds and checks against GitHub's length limit. When another skill asks for the issue, it creates it with `gh` after the user confirms the draft. It decides the project fields such as priority and size, splits an epic into a parent and sub-issues, shows a changed flow or structure as a diagram, sets one `app: <name>` label per application in a repository with several, and attaches the interview as the first comment. Every issue is written in English.

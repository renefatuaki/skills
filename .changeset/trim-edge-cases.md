---
"forge": minor
---

Code written with forge handles a case only when it occurs in normal use. That is when a caller passes the value, a system boundary lets it in, an acceptance criterion asks for it, or an observed bug shows it. A rare race, a coincidence of several actors or the leftovers of a run that stopped halfway do not count. The `clean-code` skill keeps every other case out of new code and out of its tests. The new `trim-edge-cases` skill removes such cases from every function a diff touches, as a `refactor` commit of its own. The Ticket playbook and Opening a PR run it once the change is done. A judge on Fable, the new `edge-case judge` role, decides for each case whether it occurs in normal use, in `trim-edge-cases` and for the findings of `/interrogate`. The reviewers of `/interrogate` no longer raise such cases, and its lead dismisses a finding the judge rules out. The runners of `/architect` leave them out of a design, and a design that handles one is marked down.

---
"forge": minor
---

Finished criteria are now ticked in the issue. The Ticket playbook ticks a criterion once its test is green and verified, and a resumed ticket catches up on the ticks it missed. A criterion no test can prove becomes a test step marked `(criterion <n>)`, and `pull-request-review` ticks it once that step passes. `today-issues` asks whether to tick the success criteria of finished epics and close them. The `issue` skill writes every criterion as a checkbox, a Given/When/Then inside its item. The new `tick-criteria.mts` script of the `issue` skill does the ticking and never clears a tick.

---
"forge": minor
---

The Ticket playbook no longer starts two tickets of one repository from the same `dev`. Step 4 runs `ticket-base.mts`, which reads the ticket's open blockers and the tickets it collides with, those In progress or In review on its board with a branch in the same repository, unless their `app: <name>` labels name no common app. A ticket starts on the top open pull request of those tickets as the next layer of a stack, and waits while one of them has no open pull request yet or their pull requests form several stacks. A request with several tickets runs once per ticket, so tickets that collide run one after another.

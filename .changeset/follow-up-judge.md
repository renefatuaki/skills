---
"forge": minor
---

An auto run of the Ticket playbook no longer files an issue for every piece of work a subagent reports. A judge on the new `follow-up judge` role, `fable/xhigh` by default, decides first whether the work is needed and whether it belongs in the ticket's branch. Work that is not needed is dropped, work that belongs to the ticket lands in the branch as its own commit, and only the rest becomes an issue. The Notes for the reviewer name what the judge dropped or took in.

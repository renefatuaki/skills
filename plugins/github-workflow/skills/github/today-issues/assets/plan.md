<!-- The plan of one day, the reviews first, then one table per track, then the sums against the budgets, then what stays out and what the tickets lack. -->
<!-- A section without a row is left out. On a board with several repositories a ticket is written <repo>#<number> wherever it is named, the repository without its owner. -->
<!-- <start> says when a track starts, as "starts first", "alongside A" or "after A", and for an epic "runs alone, starts first" or "runs alone after A and B". A track over several repositories names each of them. -->

**<weekday>, <time>** · <tickets> tickets in <tracks> tracks · <reviews> reviews

### Reviews

<!-- The tickets that are In review. They cost the user's review and no run. -->

| # | Ticket | Pull request | Review | Reason |
|---|---|---|---|---|
| 1 | [#<number> <title>](<url>) | [#<number>](<url>), or none | <review> | <reason> |

### Track A · <app or repository> · <start>

| # | Ticket | Run | Questions | Review | Reason |
|---|---|---|---|---|---|
| 1 | [#<number> <title>](<url>) | <run> | <questions> | <review> | <reason> |
| 2 | [#<number> <title>](<url>) | <run> | <questions> | <review> | Starts once #<blocker> is merged. <reason> |

### Track B · <app or repository> · <start>

| # | Ticket | Run | Questions | Review | Reason |
|---|---|---|---|---|---|
| 1 | [#<number> <title>](<url>) | <run> | <questions> | <review> | <reason> |

### Track C · Epic [#<number> <title>](<url>) · <app or repository> · <start>

| # | Ticket | Run | Questions | Review | Reason |
|---|---|---|---|---|---|
| 1 | [#<number> <title>](<url>) | <run> | <questions> | <review> | <reason> |

### Budgets

| Budget | Planned | Given |
|---|---|---|
| Total | <run of the longest track, with the tracks it waits for> | <total> |
| Questions | <sum> | <questions> |
| Review | <sum> | <review> |

### Not today

- [#<number> <title>](<url>). <the budget it exceeds, the open blocker it waits for, its Status Blocked, or the epic that continues on another day>

### Gaps

- [#<number> <title>](<url>). <the field or label it lacks and what the plan assumed for it, or that every sub-issue of the epic is closed and it can be closed>

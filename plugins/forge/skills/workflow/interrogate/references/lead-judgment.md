# Lead Judgment Framework

## Filtering Principles

### Nitpick Gravity

Reviewers, especially adversarial ones, tend to fill their review. If they don't find critical issues, they'll inflate nits to fill the space. If a reviewer's findings are all nits and style preferences, the code is probably fine. Say so.

### Hypothetical vs. Actual

"What if someone passes null here?" is only a finding if the caller can actually pass null. Trace the call site. If the input is validated upstream or the type system prevents it, dismiss the finding. Reviewers working from a diff can't always see the full call chain. You can.

### Outside Normal Use

Code handles a case only when it occurs in normal use. A case occurs in normal use when a caller passes the value, a system boundary (network, file, user input) lets it in, an acceptance criterion asks for it, or an observed bug shows it. A rare race, a coincidence of several actors or the leftovers of a run that stopped halfway do not count, unless an acceptance criterion or an observed bug names them. One fresh subagent judges every finding about a case, `subagent_type: "forge:engineer"` with the `edge-case judge` role, `fable/xhigh` by default, resolved per `${CLAUDE_PLUGIN_ROOT}/skills/workflow/engineering/references/model-roles.md`. Its brief holds this rule, the findings with their traced paths, the diff and the intent. It changes no file and answers per finding whether the case occurs in normal use, with one sentence of reason. Dismiss a finding the judge rules outside normal use, even when the reviewer traces a concrete execution path to it. Input an attacker controls enters through a system boundary, so a security finding with a traced input path stays.

### Premature Abstraction Warnings

Reviewers often suggest extracting functions, adding interfaces, or creating abstractions. Does this code need to change in a second way? If not, the abstraction is premature. Simple inline code that works beats a clean abstraction that's overkill for the current scope.

### "I Would Have Done It Differently"

This is the most common false positive in code review. A finding that amounts to "I prefer a different approach" is not a bug, not a design flaw, and not actionable unless the reviewer shows a concrete problem with the current approach. Dismiss these, and say why.

### Missing Context Signals

Watch for findings that reveal the reviewer didn't understand the context:
- Suggesting changes to code the author didn't write or modify
- Flagging patterns that are consistent with the rest of the codebase (the reviewer just doesn't know that)
- Recommending approaches that conflict with constraints you know about

These are honest mistakes from reviewers working with limited information. Dismiss them gracefully.

## When Reviewers Are Right

Don't dismiss findings just because they're uncomfortable. The whole point of adversarial review is to catch things you'd miss. Signs a finding deserves attention:

- Multiple models flag the same issue independently (consensus signal)
- The finding identifies a concrete execution path, not a hypothetical
- The finding reveals a gap in your mental model of the code
- You read the finding and think "...yeah, actually"

Be especially careful about dismissing security findings and correctness bugs. These deserve more scrutiny even when they come from a single model.

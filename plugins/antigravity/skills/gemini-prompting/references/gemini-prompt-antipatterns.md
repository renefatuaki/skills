# Gemini Prompt Anti-Patterns

Avoid these when prompting Antigravity or Gemini.

## Vague task framing

Bad:

```text
Take a look at this and let me know what you think.
```

Better:

```xml
<task>
Based on the diff above, review this change for material correctness and regression risks.
</task>
```

## Missing output contract

Bad:

```text
Investigate and report back.
```

Better:

```xml
<structured_output_contract>
Return:
1. root cause
2. evidence
3. smallest safe next step
Put the whole result in your final message.
</structured_output_contract>
```

## No follow-through default

Bad:

```text
Debug this failure.
```

Better:

```xml
<default_follow_through_policy>
Nobody can answer questions during this run.
Keep going until you have enough evidence to identify the root cause confidently.
</default_follow_through_policy>
```

## Context the run cannot see

Bad:

```text
Fix the bug we discussed earlier.
```

Better:

```xml
<context>
Base: <SHA or branch>
Files involved: <repository-relative paths>
Failing command: <command>
Output:
<pasted output>
</context>
```

## Commands in a read-only run

Bad:

```text
Run the tests and the diff against main, then review the change.
```

Better:

- Paste the failing output and the diff into `<context>` of a read-only run.
- Use a write-capable run when Antigravity must run the commands itself.

## Task before long context

Bad:

```text
Find the race condition in this log.
<several thousand lines of log>
```

Better:

```xml
<context>
<several thousand lines of log>
</context>

<task>
Based on the log above, find the race condition and the two threads involved.
</task>
```

## Persuasion or scripted reasoning instead of a better contract

Bad:

```text
This is EXTREMELY important. Think step by step, write out all your reasoning, and be absolutely sure.
```

Better:

```xml
<verification_loop>
Before finalizing, verify that the answer matches the observed evidence and task requirements.
</verification_loop>
```

For a problem that needs heavy reasoning, add one plain line such as "Think very hard before answering."

## Mixing unrelated jobs into one run

Bad:

```text
Review this diff, fix the bug you find, update the docs, and suggest a roadmap.
```

Better:

- Run review first.
- Run a separate fix prompt if needed, with the review findings in `<context>`.
- Use a third run for docs or roadmap work.

## Mixing delimiter styles

Bad:

```text
# Constraints
Keep changes small.
<task>
Fix the parser.
</task>
```

Better:

```xml
<action_safety>
Keep changes tightly scoped to the stated task.
</action_safety>

<task>
Based on the context above, fix the parser.
</task>
```

## Unsupported certainty

Bad:

```text
Tell me exactly why production failed.
```

Better:

```xml
<grounding_rules>
Base every claim on the context above, the files you read, and your tool outputs.
If the answer is not in them, say that it is not available.
If a point is an inference, label it clearly.
</grounding_rules>
```

# Prompt Blocks

Use these blocks selectively when composing Antigravity or Gemini prompts.
Wrap each block in the XML tag shown in its heading.
Start with `run_mode` and `role`, follow with the other blocks, then `context`, and end with `task`.

## Core Wrapper

### `run_mode`

Use in every prompt.

```xml
<run_mode>
This run is read-only. You can read files in the workspace.
Writing files and running shell commands are denied, so do not plan steps that need them.
</run_mode>
```

```xml
<run_mode>
This run can edit files and run shell commands in <worktree path> on branch <branch>.
Commands run in a sandbox that may have no network access, so prefer checks that run offline.
</run_mode>
```

### `role`

Use when a domain lens changes the answer. Keep it to one or two sentences.

```xml
<role>
You are a senior <domain> engineer. You are precise, analytical, and persistent.
</role>
```

### `context`

Use in nearly every prompt. The run sees only the prompt and the workspace.

```xml
<context>
Repository root: <path>
Base: <SHA or branch>
Files: <repository-relative paths, with line ranges where they help>
Conventions the task depends on: <rules not in GEMINI.md or AGENTS.md>
<pasted failure output, diff, or other material the run cannot fetch>
</context>
```

### `task`

Use in every prompt. Put it last, after the context.

```xml
<task>
Based on the context above, <concrete job>.
Done means <expected end state>.
</task>
```

## Output and Format

### `structured_output_contract`

Use when the response shape matters. For strict JSON with a complex schema, prefer structured output that the runtime enforces over prompt-only formatting.

```xml
<structured_output_contract>
Return exactly the requested output shape and nothing else.
Put the highest-value findings or decisions first.
Your final message is the only text the caller receives. Put the whole result in it, not a plan or a status line.
</structured_output_contract>
```

### `compact_output_contract`

Use when you want short prose instead of a schema. Gemini answers tersely by default, so name what the prose must cover.

```xml
<compact_output_contract>
Answer in short prose that covers <items>.
Do not include scene-setting or a recap of the task.
</compact_output_contract>
```

### `example_output`

Use when prose describes the shape poorly. Give one or two short examples with the exact structure and placeholder content, all in the same format. More examples make the run copy them too closely.

```xml
<example_output>
1. [high] src/cache.ts:42 stale entry survives invalidate()
   Evidence: invalidate() clears byKey but not byTag.
</example_output>
```

## Follow-through and Completion

### `default_follow_through_policy`

Use in every run. Nobody answers questions during an `agy` run.

```xml
<default_follow_through_policy>
Nobody can answer questions during this run.
Default to the most reasonable low-risk interpretation and keep going.
When a missing detail changes correctness or safety, stop and name it in your answer instead of guessing.
</default_follow_through_policy>
```

### `completeness_contract`

Use for debugging, implementation, or any multi-step task that should not stop early.

```xml
<completeness_contract>
Resolve the task fully before stopping.
Do not stop at the first plausible answer or at a plan.
Check whether there are follow-on fixes, edge cases, or cleanup needed for a correct result.
</completeness_contract>
```

### `verification_loop`

Use when correctness matters. A write-capable run names the exact command that checks the work. A read-only run checks against the files it read.

```xml
<verification_loop>
Before finalizing, run <test or build command> and fix what it reports.
If no test covers the changed path, add one first.
If a check fails, revise the work instead of reporting the first draft.
</verification_loop>
```

```xml
<verification_loop>
Before finalizing, re-read the code each claim depends on and verify the answer against it and the task requirements.
If a check fails, revise the answer instead of reporting the first draft.
</verification_loop>
```

## Grounding and Missing Context

### `missing_context_gating`

Use when Antigravity might otherwise guess.

```xml
<missing_context_gating>
Do not guess missing repository facts.
If required context is absent, read it from the workspace or state exactly what remains unknown.
</missing_context_gating>
```

### `grounding_rules`

Use for review, research, or root-cause analysis.

```xml
<grounding_rules>
Base every claim on the context above, the files you read, and your tool outputs.
If the answer is not in them, say that it is not available.
Do not present inferences as facts. Label a hypothesis as one.
</grounding_rules>
```

### `citation_rules`

Use when external research or quotes matter.

```xml
<citation_rules>
Back important claims with citations or explicit references to the source material you inspected.
Prefer primary sources.
</citation_rules>
```

### `current_date`

Use when the answer depends on recent facts or a web search.

```xml
<current_date>
Today is <YYYY-MM-DD>. Use this date for anything time-sensitive, search queries included.
</current_date>
```

## Safety and Scope

### `action_safety`

Use for write-capable or potentially broad tasks.

```xml
<action_safety>
Keep changes tightly scoped to the stated task and to <worktree path>.
Avoid unrelated refactors, renames, or cleanup unless they are required for correctness.
Reading and exploring are low risk. Writes and commands that change state are high risk, so take only the ones the task needs.
Name any irreversible action in your answer instead of taking it.
</action_safety>
```

### `tool_persistence_rules`

Use for long-running tool-heavy tasks.

```xml
<tool_persistence_rules>
Keep using tools until you have enough evidence to finish the task confidently.
Retry a transient error. After any other error, change the approach or the arguments instead of repeating the same call.
Do not abandon the workflow after a partial read when another targeted check would change the answer.
</tool_persistence_rules>
```

## Task-Specific Blocks

### `research_mode`

Use for exploration, comparisons, or recommendations.

```xml
<research_mode>
Separate observed facts, reasoned inferences, and open questions.
Prefer breadth first, then go deeper only where the evidence changes the recommendation.
</research_mode>
```

### `hypothesis_rules`

Use for diagnosis and root-cause analysis.

```xml
<hypothesis_rules>
Look past the most obvious cause. The likeliest explanation is not always the simplest.
Rank hypotheses by likelihood, and keep an unlikely one until the evidence rules it out.
When the evidence disproves a hypothesis, form a new one from what you observed.
</hypothesis_rules>
```

### `dig_deeper_nudge`

Use for review and adversarial inspection.

```xml
<dig_deeper_nudge>
After you find the first plausible issue, check for second-order failures, empty-state behavior, retries, stale state, and rollback paths before you finalize.
</dig_deeper_nudge>
```

### `progress_updates`

Use when the run may take a while. Only the final message reaches the caller.

```xml
<progress_updates>
Keep text between tool calls brief, or skip it.
Put the full result in your final message, not in progress notes.
</progress_updates>
```

# Gemini Prompt Recipes

Use these as starting templates for Antigravity task prompts or other Gemini prompt construction.
Copy the smallest recipe that fits the task, then trim anything you do not need.
Each recipe names its run mode. A read-only run reads workspace files, but writes and shell commands are denied, so the prompt carries any command output or diff the run needs. A write-capable run edits files and runs shell commands in the sandbox of `agy`.
The run does not see the Claude conversation. Fill every placeholder with file pointers, the base ref, and the exact output format.

## Diagnosis

Read-only. Paste the failing command and its output, because the run cannot reproduce it.

```xml
<run_mode>
This run is read-only. You can read files in the workspace.
Writing files and running shell commands are denied, so do not plan steps that need them.
</run_mode>

<compact_output_contract>
Return a compact diagnosis with:
1. most likely root cause, with file and line
2. evidence from the code and the failure output
3. smallest safe next step
Put the whole diagnosis in your final message.
</compact_output_contract>

<default_follow_through_policy>
Nobody can answer questions during this run.
Keep going until you have enough evidence to identify the root cause confidently.
When a missing detail changes the diagnosis, name it in your answer instead of guessing.
</default_follow_through_policy>

<hypothesis_rules>
Look past the most obvious cause. The likeliest explanation is not always the simplest.
Rank hypotheses by likelihood, and keep an unlikely one until the evidence rules it out.
</hypothesis_rules>

<verification_loop>
Before finalizing, verify that the proposed root cause explains the observed failure output.
</verification_loop>

<missing_context_gating>
Do not guess missing repository facts.
If required context is absent, read it from the workspace or state exactly what remains unknown.
</missing_context_gating>

<context>
Repository root: <path>
Base: <SHA or branch>
Files involved: <repository-relative paths>
Failing command: <command>
Output:
<pasted output>
</context>

<task>
Based on the context above, diagnose why the failing command breaks.
</task>
```

## Narrow Fix

Write-capable.

```xml
<run_mode>
This run can edit files and run shell commands in <worktree path> on branch <branch>.
Commands run in a sandbox that may have no network access, so prefer checks that run offline.
</run_mode>

<structured_output_contract>
Return:
1. summary of the fix
2. touched files
3. verification performed, with each command and its result
4. residual risks or follow-ups
Put the whole result in your final message.
</structured_output_contract>

<default_follow_through_policy>
Nobody can answer questions during this run.
Default to the most reasonable low-risk interpretation and keep going.
</default_follow_through_policy>

<completeness_contract>
Resolve the task fully before stopping.
Do not stop after identifying the issue without applying the fix.
</completeness_contract>

<verification_loop>
Before finalizing, run <test command> and fix what it reports.
If no test covers the failing path, add one first.
</verification_loop>

<action_safety>
Keep changes tightly scoped to the stated task.
Avoid unrelated refactors or cleanup.
</action_safety>

<context>
Base: <SHA or branch>
Files involved: <repository-relative paths>
Failure: <command and pasted output, or the diagnosis from an earlier run>
</context>

<task>
Based on the context above, implement the smallest safe fix for <issue>.
Preserve existing behavior outside the failing path.
</task>
```

## Root-Cause Review

Read-only. Paste the diff, because the run cannot call `git`.

```xml
<run_mode>
This run is read-only. You can read files in the workspace.
Writing files and running shell commands are denied, so do not plan steps that need them.
</run_mode>

<role>
You are a senior <language or domain> reviewer. You are precise and analytical.
</role>

<structured_output_contract>
Return:
1. findings ordered by severity, each with file and line
2. supporting evidence for each finding
3. brief next steps
If there are no material findings, say so.
Put the whole review in your final message.
</structured_output_contract>

<grounding_rules>
Base every claim on the diff, the files you read, and your tool outputs.
If a point is an inference, label it clearly.
</grounding_rules>

<dig_deeper_nudge>
Check for second-order failures, empty-state handling, retries, stale state, and rollback paths before finalizing.
</dig_deeper_nudge>

<verification_loop>
Before finalizing, re-read the code behind each finding and verify that it is material and actionable.
</verification_loop>

<context>
Base: <SHA or branch>
Changed files: <repository-relative paths>
Diff of <base>...<head>:
<pasted diff>
</context>

<task>
Based on the diff above, analyze this change for the most likely correctness or regression issues.
</task>
```

## Research Or Recommendation

Read-only.

```xml
<run_mode>
This run is read-only. You can read files in the workspace.
Writing files and running shell commands are denied, so do not plan steps that need them.
</run_mode>

<structured_output_contract>
Return:
1. observed facts
2. reasoned recommendation
3. tradeoffs
4. open questions
Put the whole result in your final message.
</structured_output_contract>

<research_mode>
Separate observed facts, reasoned inferences, and open questions.
Prefer breadth first, then go deeper only where the evidence changes the recommendation.
</research_mode>

<citation_rules>
Back important claims with explicit references to the sources you inspected.
Prefer primary sources.
</citation_rules>

<current_date>
Today is <YYYY-MM-DD>. Use this date for anything time-sensitive, search queries included.
</current_date>

<context>
Options under consideration: <options>
Constraints: <constraints>
Relevant files: <repository-relative paths>
</context>

<task>
Based on the context above, research the available options and recommend the best path for <decision>.
</task>
```

## Implementation

Write-capable, in a worktree the run owns.

```xml
<run_mode>
This run can edit files and run shell commands in <worktree path> on branch <branch>.
Commands run in a sandbox that may have no network access, so prefer checks that run offline.
</run_mode>

<structured_output_contract>
Return:
1. summary of the change
2. touched files
3. verification performed, with each command and its result
4. open issues
Put the whole result in your final message.
</structured_output_contract>

<default_follow_through_policy>
Nobody can answer questions during this run.
Default to the most reasonable low-risk interpretation and keep going.
When a missing detail changes correctness, name it in your answer instead of guessing.
</default_follow_through_policy>

<completeness_contract>
Resolve the task fully before stopping.
Do not stop at a plan. Read the files named in the context, then make the change.
</completeness_contract>

<verification_loop>
Before finalizing, run <test, typecheck, and lint commands> and fix what they report.
If a check fails, revise the work instead of reporting the first draft.
</verification_loop>

<action_safety>
Keep changes tightly scoped to the stated task and to <worktree path>.
Avoid unrelated refactors, renames, or cleanup unless they are required for correctness.
Name any irreversible action in your answer instead of taking it.
</action_safety>

<tool_persistence_rules>
Retry a transient error. After any other error, change the approach or the arguments instead of repeating the same call.
</tool_persistence_rules>

<context>
Base: <SHA or branch>
Spec: <the requirement, or the issue text>
Files to read first: <repository-relative paths>
Conventions the task depends on: <rules not in GEMINI.md or AGENTS.md>
</context>

<task>
Based on the context above, implement <feature>.
Done means <observable end state>.
</task>
```

## Prompt-Patching

Read-only.

```xml
<run_mode>
This run is read-only. You can read files in the workspace.
Writing files and running shell commands are denied, so do not plan steps that need them.
</run_mode>

<structured_output_contract>
Return:
1. failure modes
2. root causes in the current prompt
3. a revised prompt
4. why the revision should work better
Put the whole result in your final message.
</structured_output_contract>

<grounding_rules>
Base your diagnosis on the prompt text and the failure examples provided.
Do not invent failure modes that are not supported by the examples.
</grounding_rules>

<verification_loop>
Before finalizing, make sure the revised prompt resolves the cited failure modes without adding contradictory instructions.
</verification_loop>

<context>
Current prompt:
<pasted prompt>
Failure examples:
<pasted outputs>
</context>

<task>
Based on the context above, diagnose why this prompt is underperforming and propose the smallest high-leverage changes to improve it for Antigravity or Gemini.
</task>
```

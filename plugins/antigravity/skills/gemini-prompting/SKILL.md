---
name: gemini-prompting
description: Internal guidance for composing Antigravity and Gemini prompts for coding, review, diagnosis, and research tasks inside the Antigravity Claude Code plugin
user-invocable: false
---

# Gemini Prompting

Use this skill when `antigravity:antigravity-rescue` needs to ask Antigravity for help. The `agy` CLI runs a Gemini model named by a slug such as `gemini-3.8-flash-high` or `gemini-4-argon-high`.

Prompt Antigravity like an operator handing over a complete brief. The run does not see the Claude conversation. Keep prompts short, direct, and block-structured with XML tags. State the run mode, the output contract, the follow-through defaults, the context, the task, and the small set of extra constraints that matter.

Core rules:

- Prefer one clear task per Antigravity run. Split unrelated asks into separate runs, or chain them so one run's output feeds the next.
- Tell Antigravity what done looks like. Do not assume it will infer the desired end state.
- State the goal plainly. Leave out persuasive emphasis and elaborate prompt-engineering scaffolds.
- Define every term the run could read two ways, such as "the bug" or "small".
- Carry everything the run needs. Name files by repository-relative path, the base SHA or branch, and the exact output format.
- Add explicit grounding and verification rules for any task where unsupported guesses would hurt quality.
- Prefer better prompt contracts over a heavier effort.
- Use XML tags consistently so the prompt has stable internal structure. Never mix them with Markdown headings in one prompt.

Default prompt recipe, in this order:

- `<run_mode>` says whether the run is read-only or write-capable. A write-capable run also names the worktree and branch it owns.
- `<structured_output_contract>` or `<compact_output_contract>` sets the exact shape, the ordering, and the detail each part needs.
- `<default_follow_through_policy>` says what Antigravity does by default, because nobody answers its questions during the run.
- `<verification_loop>` or `<completeness_contract>` is required for debugging, implementation, or risky fixes.
- `<grounding_rules>` or `<citation_rules>` is required for review, research, or anything that could drift into unsupported claims.
- `<context>` holds the file pointers, the base ref, and any pasted output or diff.
- `<task>` comes last. It opens with "Based on the context above" and names the concrete job.

When to add blocks:

- For coding or debugging, add `completeness_contract`, `verification_loop`, and `missing_context_gating`.
- For diagnosis, add `hypothesis_rules`.
- For review or adversarial review, add `grounding_rules`, `structured_output_contract`, and `dig_deeper_nudge`.
- For research or recommendation tasks, add `research_mode` and `citation_rules`, and `current_date` when the answer depends on recent facts.
- For write-capable tasks, add `action_safety` so Antigravity stays narrow and avoids unrelated refactors.
- For an output shape that prose describes poorly, add `example_output`.
- For a domain lens that changes the answer, such as a security review, add `role`.

How to choose run shape:

- Use a read-only run for review, research, judging, and diagnosis from pasted output. It reads workspace files, but writes and shell commands are denied. It cannot run tests or `git`, so paste the failure output or the diff it needs into `<context>`.
- Use a write-capable run when Antigravity must change code or run commands. It edits files and runs shell commands in the terminal sandbox of `agy`, which has no network access by default. Name the offline commands that verify the work.
- A fresh `agy` run starts without memory. When the run continues an earlier Antigravity conversation, send only the delta instruction instead of restating the whole prompt unless the direction changed materially.
- Antigravity reads `GEMINI.md` or `AGENTS.md` at the workspace root. State any other convention the task depends on in `<context>`.

Working rules:

- Prefer explicit prompt contracts over vague nudges.
- Use stable XML tag names that match the block names from the reference file.
- Do not raise the effort first. Tighten the prompt and the verification rules, then use the lowest effort that meets the quality bar.
- Do not ask for the reasoning in the answer or script elaborate chain-of-thought steps. Gemini thinks before it answers. For a problem that needs heavy reasoning, one plain line such as "Think very hard before answering." helps at the cost of thinking tokens.
- Do not steer randomness. `agy` has no temperature setting, and Gemini 4 and Gemini 3.6 or later ignore one. Fix inconsistent output with a tighter contract or an example.
- Gemini answers tersely by default. Ask explicitly for the detail you need, such as the evidence for each finding.
- Only the final message reaches the caller. Ask for the whole result there, not a plan or a status line.
- Keep claims anchored to observed evidence. If something is a hypothesis, say so.

Prompt assembly checklist:

1. State the run mode in `<run_mode>`.
2. Choose the smallest output contract that still makes the answer easy to use. Add one example when the shape matters.
3. Decide what Antigravity does when a detail is missing, since it cannot ask.
4. Add verification, grounding, and safety tags only where the task needs them.
5. Put the file pointers, the base ref, and the pasted output in `<context>`.
6. Define the exact task and scope in `<task>`, after the context.
7. Remove redundant instructions and persuasive wording before sending the prompt.

Reusable blocks live in [references/prompt-blocks.md](references/prompt-blocks.md).
Concrete end-to-end templates live in [references/gemini-prompt-recipes.md](references/gemini-prompt-recipes.md).
Common failure modes to avoid live in [references/gemini-prompt-antipatterns.md](references/gemini-prompt-antipatterns.md).

## Sources

- [Prompt design strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies)
- [Gemini 3 developer guide](https://ai.google.dev/gemini-api/docs/gemini-3)
- [What's new in Gemini 4 Argon](https://ai.google.dev/gemini-api/docs/latest-model)
- [Thinking prompting guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking/prompting-guide)
- [Antigravity CLI headless mode](https://antigravity.google/docs/cli/headless)
- [Antigravity CLI best practices](https://antigravity.google/docs/cli/best-practices)
- [Antigravity terminal sandbox](https://antigravity.google/docs/sandbox)

# Build the change and clean the diff

The build playbooks share one discipline. Say what you observed, let the playbook demand the evidence. This page shows what to put in the prompt for each common build task, then the cleanup habit that keeps diffs reviewable.

## Prompt each build playbook with what you know

A bug prompt states the symptom and asks for a reproduction first:

```text
/engineering this command emits two records after a retry. repro first, then fix and verify.
```

A feature prompt states the behavior and what must not change:

```text
/engineering add a --json flag. text output stays byte-identical. verify both forms.
```

A refactoring prompt pins behavior before structure moves:

```text
/engineering move parsing into one module, zero behavior change. record the current output first and prove it's unchanged after.
```

A perf prompt states the measurement, not a vibe:

```text
/engineering startup takes 1.8s on this fixture. trace it, fix the measured cause, show me before and after.
```

Each of these routes to its playbook ([Bug fix](../../skills/workflow/engineering/playbooks/bug-fix.md), [Feature](../../skills/workflow/engineering/playbooks/feature.md), [Refactoring](../../skills/workflow/engineering/playbooks/refactoring.md), [Perf issue](../../skills/workflow/engineering/playbooks/perf-issue.md)), and the playbook supplies the steps you didn't type: reproduce before fixing, name the data shape before implementing, pin behavior before restructuring, profile before optimizing.

For sustained improvement of one number, there's the [Hillclimb playbook](../../skills/workflow/engineering/playbooks/hillclimb.md). Give it the metric, a target, and a floor on attempts, and it loops one hypothesis at a time with a frozen measurement harness. It keeps wins and reverts everything else.

Both perf playbooks run [`/benchmark-checklist`](../../skills/verification/benchmark-checklist/SKILL.md) on their numbers. Perf issue vets its baseline and every number after it, and Hillclimb vets its harness before freezing it. [Verify and ship](./06-verify-and-ship.md#vet-a-measured-number-with-benchmark-checklist) shows when to type it yourself.

Sometimes you want the cause before any fix. For a live symptom, such as a leak, an idle CPU spin, or a visual glitch, the [Runtime forensics playbook](../../skills/workflow/engineering/playbooks/runtime-forensics.md) instruments the running process. For a profile you already captured, the [Trace forensics playbook](../../skills/workflow/engineering/playbooks/trace-forensics.md) reads the artifact and maps the hot frame to source. Both return a diagnosis, not a fix:

```text
/engineering here's a cpuprofile from the slow startup. tell me where the time goes and which source lines own it. no fix yet.
```

## Write the failing test first with `/tdd`

When a bug has a cheap local test path, the whole prompt can be two words:

```text
/tdd implement
```

In context, that's enough. [`/tdd`](../../skills/workflow/tdd/SKILL.md) writes the smallest test that fails for the intended reason, then the fix, then reruns the test. If a test would need broad harness setup or brittle mocks, the skill says so and uses the closest executable check instead. Don't force a test where a real command is stronger evidence.

## Load the TypeScript rules by name

[`typescript-best-practices`](../../skills/clean-code/typescript-best-practices/SKILL.md) turns the type-system principles into concrete rules: discriminated unions, `unknown` at boundaries, exhaustive variants, schema-derived types. It doesn't load on its own, so type `/typescript-best-practices` when a task touches `.ts` or `.tsx` files.

## Clean before you commit

The [Opening a PR playbook](../../skills/workflow/engineering/playbooks/pull-request.md) runs the [`clean-code`](../../skills/clean-code/clean-code/SKILL.md) skill over the diff of the branch, then the [`code-comments`](../../skills/clean-code/code-comments/SKILL.md) skill over the same diff, and commits what they change with the [`commit`](../../skills/git/commit/SKILL.md) skill. The [`pull-request`](../../skills/github/pull-request/SKILL.md) skill writes the PR description to the [`technical-writing`](../../skills/docs/technical-writing/SKILL.md) rules.

For prose, [`/unslop`](../../skills/docs/unslop/SKILL.md) takes a target and any extra rules you have:

```text
/unslop the readme changes, no emdashes
```

You'll develop your own shorthand. The skill reads intent fine from terse prompts like `unslop that, tighten it`.

## Hold the comments to one rule with `code-comments`

Comments need their own pass. The [`code-comments`](../../skills/clean-code/code-comments/SKILL.md) skill keeps a comment only when it tells the reader something the code cannot: what a non-obvious symbol does, why a foreign API is used the way it is, or how a complex workflow proceeds. Everything else the code says through its names. A stale comment gets rewritten or deleted. Commented-out code and a `TODO` without an issue link come out.

The skill runs whenever code that carries comments gets written or edited, and a hook reports rule violations after every edit. Opening a PR runs it once more over the whole diff. To run it by hand:

```text
check the comments in the diff with code-comments
```

The division of labor is worth keeping straight. `clean-code` cleans slop out of the code, `/unslop` cleans it out of prose, and `code-comments` holds every comment to its rule.

**Pitfall:** cleanup is not optional polish. A diff with narrating comments and defensive dead weight reads as unfinished to reviewers, and the extra code is where the next bug hides. If the diff feels padded, say `run clean-code over the diff` before you commit, not after review calls it out.

Next: [Verify and ship](./06-verify-and-ship.md).

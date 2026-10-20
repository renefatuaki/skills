# Upstream sources

Which outside text does this plugin carry, and how does it stay in sync with its source?

Parts of this plugin are copied word for word from other projects. This file names each source, the commit the copy is based on, every change made to fit Claude Code and this repository, and what was left out. Run `pnpm run check-upstream` to list what changed upstream since the recorded commit.

## Sources

| Source | Path | License | Base commit |
| --- | --- | --- | --- |
| [pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan | `pstack/` | MIT | `978ca6e9c0e012047cd5058b8e829240336e704e` |
| [Cursor Team Kit](https://github.com/cursor/plugins/tree/main/cursor-team-kit) by Cursor | `cursor-team-kit/` | MIT | `978ca6e9c0e012047cd5058b8e829240336e704e` |
| [Claude Code port of pstack](https://github.com/renefatuaki/cursor-plugins/tree/main/pstack) | `pstack/` | MIT | `743bf4515322452121c82f1387dc049104d61621` |

Both upstream sources live in the repository `cursor/plugins`. The port is not a source of content. It shows how each Cursor passage reads in Claude Code, and the copies here take that wording where the port changed the same passage.

## How a copy is made

1. Take the upstream file at the base commit.
2. Replace each Cursor passage with the port's Claude Code wording of the same passage. The port's wording covers only the Cursor passage itself. Where the port also rewords or adds text around it, the upstream text stands. Upstream text the port never saw is adapted the same way, following the mapping below.
3. Apply the mapping below.
4. Apply the cuts named in the file's row under [Files](#files).

Nothing else changes. Quoted text keeps its own style, even where this repository's writing rules differ.

## Mapping

| Id | Upstream or port text | Text here |
| --- | --- | --- |
| M1 | the `Task` tool, a `Task` call, a Task subagent | the `Agent` tool, an `Agent` call, a subagent |
| M2 | `subagent_type: generalPurpose` | `subagent_type: "general-purpose"` |
| M3 | `readonly: true` | `Read-only: the prompt says not to edit, write, or commit anything.` |
| M4 | model slugs such as `claude-opus-5-5-xhigh` and `grok-4.7-xhigh-fast` | roles with defaults such as `opus/xhigh` and `sonnet/high`, a second family as `codex:astra/xhigh`, always with the Codex model and its effort. A Codex model is the short name `luna`, `sol` or `astra`, which `scripts/codex-model.mts` of the engineering skill resolves to the newest full name the Codex CLI lists. The port writes `codex/xhigh` and also accepts `codex`, `codex/<effort>` and `codex:<model>`, which are dropped here, along with the sentences on a bare `codex` entry and on a Codex entry without an effort. A `codex` entry, reviewer or arm, and every `codex` form, read a Codex entry, a Codex reviewer, a Codex arm. `hardest tasks` keeps upstream's strongest judgment model as `opus/xhigh`, where the port writes `fable/xhigh` |
| M5 | a role line in the `pstack-models.mdc` rule, `~/.cursor/rules/pstack-models.mdc`, `~/.claude/rules/pstack-models.md` | `~/.claude/rules/models.md`, resolved per `references/model-roles.md` of the engineering skill |
| M6 | `setup-pstack`, `/setup-pstack` | `setup-models`, `/setup-models` |
| M7 | `AskQuestion` | `AskUserQuestion` |
| M8 | `poteto-agent`, `pstack:poteto-agent` as a subagent type | `forge:engineer` |
| M9 | the poteto-mode skill, `/poteto-mode` | the engineering skill, `/engineering` |
| M10 | the `cursor-team-kit` or `team-kit` plugin's `control-ui`, `control-cli` | the `control-ui`, `control-cli` skills of this plugin |
| M11 | the `deslop` skill, `/deslop`, `/team-kit:deslop` | the `clean-code` skill |
| M12 | the **no-comments** skill, `/no-comments` | the `code-comments` skill |
| M13 | Cursor's `/loop`, a Cursor restart, a cloud agent | Claude Code's `/loop`, a Claude Code restart, a Claude Code session |
| M14 | Cursor's built-in **create-skill** skill | `skill-creator:skill-creator` |
| M15 | Cursor frontmatter keys `mode`, `icon`, `color`, `reminder`, a title-case `name` | dropped, `name` is the kebab-case skill name |
| M16 | `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md`, `skills/poteto-mode/`, a relative link such as `../<name>/SKILL.md` | `${CLAUDE_PLUGIN_ROOT}/skills/<category>/<name>/SKILL.md`, `skills/workflow/engineering/`, the relative link to the new folder |
| M17 | `principle-<slug>` as a folder or in a relative link | `skills/principles/<slug>/`, the `name` stays `principle-<slug>` |
| M18 | `pstack session:`, `pstack root:` in the session context | `session:`, `plugin root:`, both written by this plugin's SessionStart hook |
| M19 | **Opening a PR** and its file `playbooks/opening-a-pr.md`, written out or implied by the kebab-case rule | the engineering skill's index resolves Opening a PR to `playbooks/pull-request.md` |
| M20 | an upstream fallback for Cursor model slugs, such as `auto`, `inherit-parent` and the rejected-slug rules | dropped where the port drops it, the fallback rules of the engineering skill's `references/model-roles.md` apply |
| M21 | the **poteto-mode** skill and its Principles section | the **engineering** skill, whose principles index lives in `references/core.md` |
| M22 | pstack as the name of the plugin, such as `pstack`, `pstack's`, a pstack skill | this plugin, this plugin's, a skill of this plugin, worded to fit the sentence. File names such as `pstack-models.mdc` keep their name |
| M23 | poteto as the name of the mode and its agent, the heading `# Poteto mode`, the heading `# Poteto subagent`, "poteto's style" | the core of the engineering skill, `# Core` in `references/core.md`, `# Engineer subagent`, "the engineering style" |
| M24 | an image line such as `![…](./images/router.jpg)` in the guide | dropped, the images are not copied |
| M25 | `.cursor/skills/<name>/` as the place of a project skill | `.claude/skills/<name>/` |
| M26 | a list of models, such as `opus`, `sonnet`, `haiku`, and `fable` | ascending by strength, `haiku`, `sonnet`, `opus`, `fable`, and for Codex `luna`, `sol`, `astra` |

Categories for M16 are `workflow`, `principles`, `verification`, `meta`, `docs`, `clean-code`, `git`, `github` and `tooling`. [plugin.json](.claude-plugin/plugin.json) lists every skill path.

## Files

One row per copied file. Cuts are changes beyond the port wording and the mapping.

| Upstream path | Path here | Cuts |
| --- | --- | --- |
| `cursor-team-kit/agents/ci-watcher.md` | `agents/ci-watcher.md` | Frontmatter `model: fast` becomes `model: haiku` and `is_background: true` becomes `background: true`, the Claude Code keys, as the port writes them. |
| `cursor-team-kit/skills/control-cli/SKILL.md` | `skills/verification/control-cli/SKILL.md` | none |
| `cursor-team-kit/skills/control-ui/SKILL.md` | `skills/verification/control-ui/SKILL.md` | none |
| `cursor-team-kit/skills/loop-on-ci/SKILL.md` | `skills/github/loop-on-ci/SKILL.md` | none |
| `cursor-team-kit/skills/verify-this/SKILL.md` | `skills/verification/verify-this/SKILL.md` | none |
| `pstack/agents/poteto-agent.md` | `agents/engineer.md` | `name: engineer`. The agent reads the engineering skill's `SKILL.md` and then `references/core.md`, because the Principles index lives in the reference. The fallback `find` pattern and the principle path follow M16 and M17. "Skills of this plugin are user-invocable only" narrows to "Skills of this plugin with disable-model-invocation are user-invocable only", to match the SessionStart hook. |
| `pstack/docs/guide/README.md` | `docs/guide/README.md` | The title and the plugin name read forge (M22). Index item 5 names code-comments in place of `/no-comments` (M12). Item 6 ends "open a PR and get its checks green". Item 7 drops "Projects and" and ends "automations that start a loop on their own". Item 11 links `11-github-workflow.md`. The `/poteto-help` paragraph and its code block are cut. |
| `pstack/docs/guide/01-setup.md` | `docs/guide/01-setup.md` | The plugin name reads forge (M22). The install section runs `/plugin install forge --marketplace renefatuaki/skills` in a Claude Code session, and Claude Code confirms it. setup-models "shows the models you can pick" in place of "detects the models you have access to", because it offers a fixed list. The budget paragraph reads "The defaults are the same as the `large` budget. `unlimited` lifts each model one effort step", and Grok becomes Codex, as setup-models words its budgets. The Auto paragraph opens "Set a role to `inherit` and the subagent runs on your session's own model." and the cost bullet sets a role to `inherit`. "chat" reads "session" where it names a Claude Code session. The Custom Mode paragraph says `/engineering` stays on for the rest of the session, as the engineering skill words it. |
| `pstack/docs/guide/02-poteto-mode.md` | `docs/guide/02-engineering.md` | Renamed per M9. "twenty-three playbooks" reads "seventeen playbooks". The list of further playbooks names the adopted ones, Ticket and Opening a PR included. The diagram node reads `Read the principles index` (M21). "a Custom Mode keeps `/engineering` in context on every turn" reads "`/engineering` stays on for the rest of the session", and "how to start one" reads "how to start it". The heading "Give parallel work its own machine" reads "its own worktree", the cloud-subagent and `/in-cloud` sentences are cut, and the worktree prompt follows the first sentence. The worktree sentence names the Ticket playbook in place of Opening a PR, because only Ticket works in its own worktree. |
| `pstack/docs/guide/03-understand.md` | `docs/guide/03-understand.md` | none |
| `pstack/docs/guide/04-design.md` | `docs/guide/04-design.md` | "Plan after the design settles" plans an epic with one sub-issue per PR through the issue skill in place of the Multi-phase plan playbook, and its last two sentences, on committing the plan to the repo, say instead that the epic stays on the board until today-issues names it ready to close. The issue skill writes each sub-issue with "the criteria its template asks for". A sentence says a part blocked by another stacks its PR on that part's. The migration prompt asks for an epic. The last ladder line reads "gets an epic with sub-issues". |
| `pstack/docs/guide/05-build-and-clean.md` | `docs/guide/05-build-and-clean.md` | "Clean before you commit" says Opening a PR runs clean-code and code-comments over the diff and commits with the commit skill, and that the pull-request skill writes the description to the technical-writing rules. The cursor-team-kit sentences are cut, and the `/unslop` link moves to the next paragraph. The `/no-comments` section is replaced by a code-comments section, "Hold the comments to one rule with `code-comments`". The division of labor and the pitfall name clean-code and code-comments. |
| `pstack/docs/guide/06-verify-and-ship.md` | `docs/guide/06-verify-and-ship.md` | The intro ends "getting its checks green". The PR prompt drops "small ordered commits". "Open the PR" describes Opening a PR here, a PR per branch against its base, ready for review, no rebase onto the base, a branch based on another PR's branch as a layer of a stack that the `gh stack` extension rebases, a test plan in the description. The Babysit section is replaced by "Get the checks green with `/loop-on-ci`", the pull-request skill, the ci-watcher agent and loop-on-ci, and the status prompt asks for the CI of the current branch. The Shipping section is cut, and one paragraph says the reviewer tests with pull-request-review, approves and merges. |
| `pstack/docs/guide/07-overnight.md` | `docs/guide/07-overnight.md` | "or cloud agent" is cut. The Pause safely paragraph is cut. The sections "When the night holds a queue, not a task" and "Run many projects in parallel" are cut. The automation-pack paragraph is cut. |
| `pstack/docs/guide/08-principles.md` | `docs/guide/08-principles.md` | none |
| `pstack/docs/guide/09-make-it-yours.md` | `docs/guide/09-make-it-yours.md` | The sentence linking "Run many projects in parallel" is cut. The `/make-bot-ui` section is cut. |
| `pstack/docs/guide/10-recipes-and-pitfalls.md` | `docs/guide/10-recipes-and-pitfalls.md` | The plan recipe asks for an epic and says each sub-issue is a ticket for `/engineering #<issue>`. The `/poteto-help` recipe is cut. The worktree pitfall drops "Run them as cloud agents, or". The `auto` pitfall is cut. "That's the guide." is cut, and the page ends with "Next" to `11-github-workflow.md`. |
| `pstack/skills/architect/SKILL.md` | `skills/workflow/architect/SKILL.md` | The frontmatter gains `allowed-tools` for `codex-model.mts` of the engineering skill, which resolves a Codex model. |
| `pstack/skills/architect/references/design-red-flags.md` | `skills/workflow/architect/references/design-red-flags.md` | none |
| `pstack/skills/architect/references/rationale-template.md` | `skills/workflow/architect/references/rationale-template.md` | none |
| `pstack/skills/architect/references/runner-prompt.md` | `skills/workflow/architect/references/runner-prompt.md` | none |
| `pstack/skills/arena/SKILL.md` | `skills/workflow/arena/SKILL.md` | The frontmatter gains `allowed-tools` for `codex-model.mts` of the engineering skill, which resolves a Codex model. |
| `pstack/skills/automate-me/SKILL.md` | `skills/meta/automate-me/SKILL.md` | none |
| `pstack/skills/benchmark-checklist/SKILL.md` | `skills/verification/benchmark-checklist/SKILL.md` | none |
| `pstack/skills/blast-radius/SKILL.md` | `skills/workflow/blast-radius/SKILL.md` | none |
| `pstack/skills/bro/SKILL.md` | `skills/meta/bro/SKILL.md` | none |
| `pstack/skills/correct/SKILL.md` | `skills/meta/correct/SKILL.md` | none |
| `pstack/skills/create-verification-skill/SKILL.md` | `skills/verification/create-verification-skill/SKILL.md` | none |
| `pstack/skills/create-verification-skill/references/feature-map-example/README.md` | `skills/verification/create-verification-skill/references/feature-map-example/README.md` | none |
| `pstack/skills/create-verification-skill/references/feature-map-example/create-note.md` | `skills/verification/create-verification-skill/references/feature-map-example/create-note.md` | none |
| `pstack/skills/create-verification-skill/references/feature-map-example/search.md` | `skills/verification/create-verification-skill/references/feature-map-example/search.md` | none |
| `pstack/skills/figure-it-out/SKILL.md` | `skills/workflow/figure-it-out/SKILL.md` | none |
| `pstack/skills/how/SKILL.md` | `skills/workflow/how/SKILL.md` | none |
| `pstack/skills/how/references/explainer-prompt.md` | `skills/workflow/how/references/explainer-prompt.md` | none |
| `pstack/skills/how/references/explorer-prompt.md` | `skills/workflow/how/references/explorer-prompt.md` | none |
| `pstack/skills/interrogate/SKILL.md` | `skills/workflow/interrogate/SKILL.md` | The frontmatter gains `allowed-tools` for `codex-model.mts` of the engineering skill, which resolves a Codex model. A Codex reviewer passes "its resolved `--model`". A fallback reviewer is "its Claude model" in place of `sonnet`, and the Reviewers example reads `opus/xhigh (codex fallback: <reason>)`. |
| `pstack/skills/interrogate/references/code-quality-review.md` | `skills/workflow/interrogate/references/code-quality-review.md` | none |
| `pstack/skills/interrogate/references/lead-judgment.md` | `skills/workflow/interrogate/references/lead-judgment.md` | none |
| `pstack/skills/interrogate/references/reviewer-prompt.md` | `skills/workflow/interrogate/references/reviewer-prompt.md` | none |
| `pstack/skills/interrogate/references/rubric.md` | `skills/workflow/interrogate/references/rubric.md` | none |
| `pstack/skills/maintain-verification-skill/SKILL.md` | `skills/verification/maintain-verification-skill/SKILL.md` | none |
| `pstack/skills/poteto-mode/SKILL.md` | `skills/workflow/engineering/references/core.md` | Frontmatter dropped, the file is a reference. The port's opening paragraph is kept. **Paths** loses `team-kit:deslop` from "Skills from other plugins", because deslop maps to clean-code (M11). The Babysit, Shipping and Bugbot triggers are cut. In Subagents "or a babysit watcher" is cut. The `## Comments` body becomes one sentence pointing to the code-comments skill, because René keeps his own comment rules. In the figure-it-out paragraph the two sentences routing to Orchestrate are cut. Seven Playbooks index lines are cut (Babysit, Shipping, Orchestrate, Autopilot-full, Autopilot-stack, Pause safely, Multi-phase or multi-PR plan). Autonomy gains the paragraph **Production data** after **Always pause**. |
| `pstack/skills/poteto-mode/playbooks/authoring-a-skill.md` | `skills/workflow/engineering/playbooks/authoring-a-skill.md` | none |
| `pstack/skills/poteto-mode/playbooks/autonomous-run.md` | `skills/workflow/engineering/playbooks/autonomous-run.md` | none |
| `pstack/skills/poteto-mode/playbooks/bug-fix.md` | `skills/workflow/engineering/playbooks/bug-fix.md` | none |
| `pstack/skills/poteto-mode/playbooks/eval.md` | `skills/workflow/engineering/playbooks/eval.md` | none |
| `pstack/skills/poteto-mode/playbooks/feature.md` | `skills/workflow/engineering/playbooks/feature.md` | Step 4 loses "Commit liberally.". Step 6 "Rebase into small, ordered commits. Stack follow-ups." becomes "Commit each verified unit in order. No rebase. A follow-up is its own ticket, blocked by this one, so its pull request stacks on this one's.", because the commit skill keeps one commit per criterion without amend or rebase, and the Ticket playbook stacks a ticket on its blocker's pull request. |
| `pstack/skills/poteto-mode/playbooks/hillclimb.md` | `skills/workflow/engineering/playbooks/hillclimb.md` | none |
| `pstack/skills/poteto-mode/playbooks/investigation.md` | `skills/workflow/engineering/playbooks/investigation.md` | "no babysit, " is cut, because Babysit is not adopted. |
| `pstack/skills/poteto-mode/playbooks/perf-issue.md` | `skills/workflow/engineering/playbooks/perf-issue.md` | none |
| `pstack/skills/poteto-mode/playbooks/prototype.md` | `skills/workflow/engineering/playbooks/prototype.md` | none |
| `pstack/skills/poteto-mode/playbooks/refactoring.md` | `skills/workflow/engineering/playbooks/refactoring.md` | Step 8 "Rebase into small ordered commits." becomes "Commit right after each step, in this order, without a rebase.". |
| `pstack/skills/poteto-mode/playbooks/runtime-forensics.md` | `skills/workflow/engineering/playbooks/runtime-forensics.md` | none |
| `pstack/skills/poteto-mode/playbooks/session-pickup.md` | `skills/workflow/engineering/playbooks/session-pickup.md` | none |
| `pstack/skills/poteto-mode/playbooks/trace-forensics.md` | `skills/workflow/engineering/playbooks/trace-forensics.md` | none |
| `pstack/skills/poteto-mode/playbooks/visual-parity.md` | `skills/workflow/engineering/playbooks/visual-parity.md` | none |
| `pstack/skills/poteto-mode/playbooks/worktree-cleanup.md` | `skills/workflow/engineering/playbooks/worktree-cleanup.md` | none |
| `pstack/skills/poteto-mode/scripts/worktree-audit.sh` | `skills/workflow/engineering/scripts/worktree-audit.sh` | The comment on the transcript directory, garbled in the port, reads `<cwd with every non-alphanumeric char replaced by "-">/`. The pull request list drops `--author "@me"`, so a pull request a GitHub App opened for the user still counts. |
| `pstack/skills/principle-attack-the-premise/SKILL.md` | `skills/principles/attack-the-premise/SKILL.md` | none |
| `pstack/skills/principle-boundary-discipline/SKILL.md` | `skills/principles/boundary-discipline/SKILL.md` | none |
| `pstack/skills/principle-build-the-lever/SKILL.md` | `skills/principles/build-the-lever/SKILL.md` | none |
| `pstack/skills/principle-encode-lessons-in-structure/SKILL.md` | `skills/principles/encode-lessons-in-structure/SKILL.md` | none |
| `pstack/skills/principle-exhaust-the-design-space/SKILL.md` | `skills/principles/exhaust-the-design-space/SKILL.md` | none |
| `pstack/skills/principle-experience-first/SKILL.md` | `skills/principles/experience-first/SKILL.md` | none |
| `pstack/skills/principle-explain-the-number/SKILL.md` | `skills/principles/explain-the-number/SKILL.md` | none |
| `pstack/skills/principle-fix-root-causes/SKILL.md` | `skills/principles/fix-root-causes/SKILL.md` | none |
| `pstack/skills/principle-foundational-thinking/SKILL.md` | `skills/principles/foundational-thinking/SKILL.md` | none |
| `pstack/skills/principle-guard-the-context-window/SKILL.md` | `skills/principles/guard-the-context-window/SKILL.md` | none |
| `pstack/skills/principle-laziness-protocol/SKILL.md` | `skills/principles/laziness-protocol/SKILL.md` | none |
| `pstack/skills/principle-make-operations-idempotent/SKILL.md` | `skills/principles/make-operations-idempotent/SKILL.md` | none |
| `pstack/skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md` | `skills/principles/migrate-callers-then-delete-legacy-apis/SKILL.md` | none |
| `pstack/skills/principle-minimize-reader-load/SKILL.md` | `skills/principles/minimize-reader-load/SKILL.md` | none |
| `pstack/skills/principle-model-the-domain/SKILL.md` | `skills/principles/model-the-domain/SKILL.md` | none |
| `pstack/skills/principle-never-block-on-the-human/SKILL.md` | `skills/principles/never-block-on-the-human/SKILL.md` | none |
| `pstack/skills/principle-outcome-oriented-execution/SKILL.md` | `skills/principles/outcome-oriented-execution/SKILL.md` | none |
| `pstack/skills/principle-prove-it-works/SKILL.md` | `skills/principles/prove-it-works/SKILL.md` | none |
| `pstack/skills/principle-redesign-from-first-principles/SKILL.md` | `skills/principles/redesign-from-first-principles/SKILL.md` | none |
| `pstack/skills/principle-separate-before-serializing-shared-state/SKILL.md` | `skills/principles/separate-before-serializing-shared-state/SKILL.md` | none |
| `pstack/skills/principle-sequence-verifiable-units/SKILL.md` | `skills/principles/sequence-verifiable-units/SKILL.md` | none |
| `pstack/skills/principle-subtract-before-you-add/SKILL.md` | `skills/principles/subtract-before-you-add/SKILL.md` | none |
| `pstack/skills/principle-test-behavior-not-implementation/SKILL.md` | `skills/principles/test-behavior-not-implementation/SKILL.md` | none |
| `pstack/skills/principle-type-system-discipline/SKILL.md` | `skills/principles/type-system-discipline/SKILL.md` | none |
| `pstack/skills/recall/SKILL.md` | `skills/meta/recall/SKILL.md` | none |
| `pstack/skills/reflect/SKILL.md` | `skills/meta/reflect/SKILL.md` | none |
| `pstack/skills/reflect/references/divergent-reviewer.md` | `skills/meta/reflect/references/divergent-reviewer.md` | none |
| `pstack/skills/reflect/references/judgment-reviewer.md` | `skills/meta/reflect/references/judgment-reviewer.md` | none |
| `pstack/skills/reflect/references/synthesizer.md` | `skills/meta/reflect/references/synthesizer.md` | none |
| `pstack/skills/reflect/references/tooling-reviewer.md` | `skills/meta/reflect/references/tooling-reviewer.md` | none |
| `pstack/skills/setup-pstack/SKILL.md` | `skills/meta/setup-models/SKILL.md` | Step 1 loses the port's "The Codex plugin installs with pstack.". The legacy sentence keeps the old Cursor file name `~/.cursor/rules/pstack-models.mdc`, because it names that file. Step 7 reads the hidden create-verification-skill by path instead of running `/pstack:create-verification-skill`. The description's trigger phrases "configure pstack models" and "pstack budget" become "configure models" and "model budget". The comment heading of the written rule names the plugin, because the rule file is read outside the plugin. Step 1 lists the Codex models and shows the full name of each through `codex-model.mts`, in place of reading `~/.codex/config.toml`, because every Codex entry names its own model and effort (M4). Steps 3 and 4 take the model from that list, and step 3 says that a Codex entry never falls back to the model and effort in `~/.codex/config.toml`. The frontmatter gains `allowed-tools` for `codex-model.mts`, because a grant applies only to the skill the user invokes. Step 2 also reads the `codex minimum` line. Step 3 gains (d), which asks for the Codex minimum. Step 4 validates it, and step 5 writes it, with a comment line in the template. |
| `pstack/skills/show-me-your-work/SKILL.md` | `skills/workflow/show-me-your-work/SKILL.md` | none |
| `pstack/skills/show-me-your-work/references/decision-log-template.tsv` | `skills/workflow/show-me-your-work/references/decision-log-template.tsv` | none |
| `pstack/skills/show-me-your-work/scripts/log.sh` | `skills/workflow/show-me-your-work/scripts/log.sh` | none |
| `pstack/skills/swarm/SKILL.md` | `skills/workflow/swarm/SKILL.md` | Cloud workers become background workers on this machine, in the port's wording (M1, M2, M4, M5, M16, M20). Removed: the cloud concurrency limit, `environment: "cloud"` and `"local"`, `cloud_base_branch`. Added from the port: N shares this machine and spawns get batched, a Codex arm is a Codex slot, each worker gets its own ports, `/tmp` subdirectory and test data, writing workers get `isolation: "worktree"`, the brief names the branch or SHA and the worker checks `git rev-parse HEAD`. The frontmatter gains `allowed-tools` for `codex-model.mts` of the engineering skill, which resolves a Codex model. |
| `pstack/skills/tdd/SKILL.md` | `skills/workflow/tdd/SKILL.md` | none |
| `pstack/skills/teach/SKILL.md` | `skills/meta/teach/SKILL.md` | none |
| `pstack/skills/technical-writing/SKILL.md` | `skills/docs/technical-writing/SKILL.md` | The sentence "Indent code snippets with tabs." is removed from its bullet. It conflicts with markdownlint MD010 (no hard tabs), and markdownlint wins. |
| `pstack/skills/typescript-best-practices/SKILL.md` | `skills/clean-code/typescript-best-practices/SKILL.md` | none |
| `pstack/skills/typescript-best-practices/references/patterns.md` | `skills/clean-code/typescript-best-practices/references/patterns.md` | none |
| `pstack/skills/unslop/SKILL.md` | `skills/docs/unslop/SKILL.md` | none |
| `pstack/skills/why/SKILL.md` | `skills/workflow/why/SKILL.md` | none |
| `pstack/skills/why/references/epistemics.md` | `skills/workflow/why/references/epistemics.md` | none |
| `pstack/skills/why/references/investigator-prompt.md` | `skills/workflow/why/references/investigator-prompt.md` | none |
| `pstack/skills/why/references/source-playbook.md` | `skills/workflow/why/references/source-playbook.md` | none |
| `pstack/skills/why/references/sources/code-archaeology.md` | `skills/workflow/why/references/sources/code-archaeology.md` | none |
| `pstack/skills/why/references/sources/databricks.md` | `skills/workflow/why/references/sources/databricks.md` | none |
| `pstack/skills/why/references/sources/datadog.md` | `skills/workflow/why/references/sources/datadog.md` | none |
| `pstack/skills/why/references/sources/incident-postmortem.md` | `skills/workflow/why/references/sources/incident-postmortem.md` | none |
| `pstack/skills/why/references/sources/linear.md` | `skills/workflow/why/references/sources/linear.md` | none |
| `pstack/skills/why/references/sources/notion.md` | `skills/workflow/why/references/sources/notion.md` | none |
| `pstack/skills/why/references/sources/sentry.md` | `skills/workflow/why/references/sources/sentry.md` | none |
| `pstack/skills/why/references/sources/slack.md` | `skills/workflow/why/references/sources/slack.md` | none |
| `pstack/skills/why/references/synthesizer-prompt.md` | `skills/workflow/why/references/synthesizer-prompt.md` | none |
| `port: pstack/hooks/hooks.json` | `hooks/hooks.json` | Only the SessionStart entry, merged into the existing file. The command runs `session-context.mts` and gains `"timeout": 10`. |
| `port: pstack/hooks/session-context.sh` | `hooks/session-context.mts` | Rewritten from shell with embedded Python into TypeScript that Node runs, sharing `addContext` in `hooks/lib/hook.mts`. The output JSON keeps its shape. "pstack skills are user-invocable only." becomes "Skills of this plugin with disable-model-invocation are user-invocable only.", because several skills of this plugin stay model-invocable. "When a pstack skill, playbook, or principle" reads "When a skill, playbook, or principle" (M22 worded to fit). |
| `port: pstack/skills/poteto-mode/references/model-roles.md` | `skills/workflow/engineering/references/model-roles.md` | Values lists the Codex models next to the Claude models, in place of "any name the Codex CLI accepts". Values adds "A Codex entry always names its model and its effort" and that Codex slots resolves the full name. Codex slots gains step 1, which resolves the model with `codex-model.mts`, and its fallback gains the case that step 1 finds no full name. Step 1 says that a failed refresh on stderr goes into the report, and that the script fails below the percent of usage left that the `codex minimum` line sets, 20 without it. Where the configuration lives adds the `codex minimum` line. The fallback picks the Claude model of the same rank, `haiku` for `luna`, `sonnet` for `sol`, and `opus` for `astra`, in place of `sonnet`. It names the usage limit as an error and treats any text other than the requested output as a failed run. A write-capable slot resets its worktree before the fallback, and a usage limit sends the remaining Codex slots of the run straight to the fallback. "The fallback keeps the panel the same size" adds "and each slot's rank". The prompt step passes the entry's effort and the full name of step 1, and says that Codex then never falls back to `~/.codex/config.toml`. |
| `port: pstack/skills/poteto-mode/references/transcripts.md` | `skills/workflow/engineering/references/transcripts.md` | "orchestrate" is cut from the list of transcript readers, which ends "and the eval and session-pickup playbooks", because Orchestrate is not adopted. |

## Not adopted

| Upstream path | Reason |
| --- | --- |
| `pstack/skills/poteto-mode/SKILL.md` (as a skill) | Replaced by the engineering skill. Its body lives on as `skills/workflow/engineering/references/core.md`. |
| `pstack/skills/poteto-mode/playbooks/opening-a-pr.md` | Replaced by the own playbook `skills/workflow/engineering/playbooks/pull-request.md`. Pull requests ready for review on `dev`, opened by the user's GitHub App, or on the branch below as a layer of a stack through the `gh stack` extension, no forge choice. Its body sections Scope, Tradeoffs and Blast Radius moved into the pull-request skill's template and its length limit into the skill's step 5. |
| `pstack/skills/poteto-mode/playbooks/babysit.md` | Built for stacks and Bugbot, and it depends on the Bun watcher in `scripts/watch-pr/`. CI watching comes from the `loop-on-ci` skill of Cursor Team Kit. |
| `pstack/skills/poteto-mode/playbooks/shipping.md, autopilot-full.md, autopilot-stack.md, orchestrate.md, multi-phase-plan.md` | An agent merging or building stacks conflicts with the reviewer's own approval. |
| `pstack/skills/poteto-mode/playbooks/pause-safely.md` | Not needed in this setup. Its `wip:` commit fails commitlint. |
| `pstack/skills/poteto-mode/references/bugbot-triage.md` | Bugbot is not used. |
| `pstack/skills/poteto-mode/scripts/` (Bun project: watch-pr, orch, check-plan.mjs, bootstrap.ts) | Only used by playbooks that are not adopted. `worktree-audit.sh` is adopted. |
| `pstack/skills/no-comments/, pstack/agents/comment-sicko.md` | René keeps the code-comments skill. |
| `pstack/skills/poteto-help/` | Its links point to the pstack repository. |
| `pstack/skills/make-bot-ui/, pstack/automations/benny/` | Cursor only. |
| `pstack/skills/ketchup/` | René decided against it. |
| `pstack/docs/guide/images/` | The pages read without them, and the plugin stays free of binary files (M24). |
| `cursor-team-kit/skills/deslop/` | The clean-code skill runs over the diff instead. Open for a later comparison. |
| `cursor-team-kit/rules/no-inline-imports.mdc, typescript-exhaustive-switch.mdc` | The first is covered by an own Imports section in the clean-code skill's `languages/typescript.md`, the second by the Exhaustiveness row of typescript-best-practices. |
| `cursor-team-kit/` every other skill, agent and rule | Stays a separate plugin. |

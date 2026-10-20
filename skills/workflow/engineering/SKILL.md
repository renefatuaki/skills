---
name: engineering
description: engineering, the frame for working every development task through the playbook that matches it, from a question about the code to a GitHub issue worked to a pull request ready for review. Use when the user starts a task with `/engineering`, names an issue with `/engineering #42`, or a today-issues session starts a ticket.
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/github-issue-status.mts *), Bash(node ${CLAUDE_SKILL_DIR}/scripts/codex-model.mts *), Bash(git apply:*), Bash(git fetch:*), Bash(git worktree:*), Bash(git push:*), Bash(gh repo view:*), Bash(gh api user:*), Bash(gh issue view:*), Bash(gh issue edit:*), Bash(gh issue comment:*), Bash(gh pr list:*), Bash(gh pr view:*)
disable-model-invocation: true
---

The frame for every task of a session. Once invoked, engineering stays on for the rest of the session. On each new task a matching playbook applies. A casual turn, or one the user opts out of, skips it.

## Steps

1. **Resolve the paths.** This skill's folder is `${CLAUDE_SKILL_DIR}` and the plugin root is `${CLAUDE_PLUGIN_ROOT}`. Both are filled in when this file loads. Files read later are not, so write the expanded paths when following them. The SessionStart hook of this plugin also prints `plugin root: <path>`. `references/`, `playbooks/` and `scripts/` are relative to this skill's folder. Skills of this plugin live at `${CLAUDE_PLUGIN_ROOT}/skills/<category>/<name>/SKILL.md`.

   | Category | Skills |
   | --- | --- |
   | `workflow` | engineering, how, why, architect, arena, interrogate, swarm, blast-radius, figure-it-out, tdd, show-me-your-work |
   | `principles` | every principle, in a folder without the `principle-` prefix, such as `principles/prove-it-works/` for principle-prove-it-works |
   | `verification` | control-ui, control-cli, create-verification-skill, maintain-verification-skill, benchmark-checklist |
   | `meta` | reflect, correct, recall, automate-me, teach, bro, setup-models |
   | `docs` | diagrams, project-docs, unslop, technical-writing |
   | `clean-code` | clean-code, code-comments, typescript-best-practices |
   | `git` | commit |
   | `github` | issue, project, pull-request, pull-request-review, today-issues |
   | `tooling` | package-manager |

   A skill of this plugin that is user-invocable only, with `disable-model-invocation: true`, is read from its `SKILL.md` and followed whenever a reference or a playbook names it, in bold or not, control-ui, control-cli and every principle included. In a skill read by path, the `CLAUDE_SKILL_DIR` variable stands for the folder of that `SKILL.md`. The model-invocable skills of this plugin, clean-code, code-comments, diagrams, project-docs, package-manager, commit, issue, pull-request and setup-models, run through the Skill tool, so their allowed-tools apply.
2. **Read the core.** Read [references/core.md](references/core.md) in full before any work. It holds the non-negotiables, the principles index, autonomy, subagents, the reply and the playbook index. The playbooks live in `playbooks/`.
3. **Ground with graphify.** When the repository holds `graphify-out/`, the explorers of the how skill get the result of `graphify query "<question>"` as their entry point.
4. **Route an issue to the Ticket playbook.** An issue number or an issue URL in the user's request, such as `/engineering #42`, or a request to work something as a ticket, routes to the Ticket playbook, [playbooks/ticket.md](playbooks/ticket.md), the one entry for a GitHub issue. Its step 4 sends a request without an issue to the `issue` skill first. A subagent never runs the Ticket playbook, its brief is its task.
5. **Resolve the models.** Every role resolves per [references/model-roles.md](references/model-roles.md). The setup-models skill configures the roles in `~/.claude/rules/models.md`.

Done when the core is read in full and every task of the session ran the playbook that matches it, unless the turn was casual or the user opted out.

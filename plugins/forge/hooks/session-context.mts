#!/usr/bin/env node

// Hands Claude the transcript of the session, the root of this plugin and the rule for a text to paste when a session starts.
// https://code.claude.com/docs/en/hooks.md#sessionstart

import { addContext, readHookInput } from './lib/hook.mts';

/** What the SessionStart hook receives on stdin, the fields this hook reads. */
type SessionInput = {
  session_id?: unknown;
  transcript_path?: unknown;
};

main();

function main(): void {
  const input = readHookInput() as SessionInput;
  const root = process.env.CLAUDE_PLUGIN_ROOT ?? '';

  addContext('SessionStart', [
    sessionLine(input),
    rootLine(root),
    clipboardLine(),
  ]);
}

function sessionLine(input: SessionInput): string {
  return `session: session_id=${orUnknown(input.session_id)} transcript_path=${orUnknown(input.transcript_path)}`;
}

/** Tells Claude to read a skill this plugin names from its file, because most of them are user-invocable only. */
function rootLine(root: string): string {
  return `plugin root: ${root}. Skills of this plugin with disable-model-invocation are user-invocable only. When a skill, playbook, or principle names another skill of this plugin (such as the **how** skill or principle-prove-it-works), read ${root}/skills/<category>/<name>/SKILL.md and follow it instead of calling the Skill tool. A principle such as **prove-it-works** lives in skills/principles/prove-it-works.`;
}

/** Sends every text meant for pasting through the clipboard skill, because its description alone does not trigger reliably. */
function clipboardLine(): string {
  return 'When you write a text the user will paste outside this session, such as an email, a chat message, a prompt for another tool, a post or a comment, run the forge:clipboard skill instead of writing the text out in the reply.';
}

function orUnknown(value: unknown): string {
  return typeof value === 'string' ? value : 'unknown';
}

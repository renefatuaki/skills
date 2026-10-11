#!/usr/bin/env node

// Runs the session context hook with a session input and with input that is no JSON, and compares its output with the expected one.

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'hooks', 'session-context.mts');
const pluginRoot = '/plugins/forge';

const ROOT_LINE =
  'plugin root: /plugins/forge. Skills of this plugin with disable-model-invocation are user-invocable only. When a skill, playbook, or principle names another skill of this plugin (such as the **how** skill or principle-prove-it-works), read /plugins/forge/skills/<category>/<name>/SKILL.md and follow it instead of calling the Skill tool. A principle such as **prove-it-works** lives in skills/principles/prove-it-works.';

/** The output of the hook, the event it names and the lines of its context. */
type Output = {
  hookEventName: string;
  lines: string[];
};

const CASES: { name: string; input: string; expected: Output }[] = [
  {
    name: 'session input',
    input: JSON.stringify({
      session_id: 'abc123',
      transcript_path: '/home/user/.claude/projects/repo/abc123.jsonl',
      cwd: '/home/user/repo',
      hook_event_name: 'SessionStart',
      source: 'startup',
    }),
    expected: {
      hookEventName: 'SessionStart',
      lines: [
        'session: session_id=abc123 transcript_path=/home/user/.claude/projects/repo/abc123.jsonl',
        ROOT_LINE,
      ],
    },
  },
  {
    name: 'input that is no JSON',
    input: 'not json',
    expected: {
      hookEventName: 'SessionStart',
      lines: ['session: session_id=unknown transcript_path=unknown', ROOT_LINE],
    },
  },
];

let failures = 0;

for (const { name, input, expected } of CASES) {
  const actual = run(input);
  const ok = JSON.stringify(actual) === JSON.stringify(expected);

  if (!ok) {
    failures++;
  }

  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  if (!ok) {
    console.log(
      `  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`,
    );
  }
}

console.log(failures === 0 ? 'All cases pass.' : `${failures} case(s) failed.`);

process.exit(failures === 0 ? 0 : 1);

/** Starts the hook as Claude Code would and returns its output. */
function run(input: string): Output {
  const result = spawnSync('node', [script], {
    input,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
  });

  if (result.status !== 0) {
    throw new Error(`hook exited with ${result.status}: ${result.stderr}`);
  }

  const { hookEventName, additionalContext } = JSON.parse(result.stdout)
    .hookSpecificOutput as { hookEventName: string; additionalContext: string };

  return { hookEventName, lines: additionalContext.split('\n') };
}

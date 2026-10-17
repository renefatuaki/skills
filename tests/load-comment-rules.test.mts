#!/usr/bin/env node

// Runs the comment rules hook against transcripts that lack or hold the rules and compares its decision with the expected one.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'hooks', 'load-comment-rules.mts');
const dir = mkdtempSync(join(tmpdir(), 'load-comment-rules-'));

const SKILL_MARKER = 'Rules for every comment you write or touch.';
const TYPESCRIPT_MARKER = 'Doc comments use TSDoc or JSDoc: `/** ... */`.';
const SKILL_BODY_LINE =
  '5. **Prune.** Every comment inside the touched symbol must still be true for the current code.';

const SKILL_PATH = join(root, 'skills/clean-code/code-comments/SKILL.md');
const GUIDE_PATH = join(
  root,
  'skills/clean-code/code-comments/languages/typescript.md',
);

const OPENING =
  'The code-comments rules apply to every code edit. They follow below. Repeat the edit with its comments following them.';

/** What the hook printed, the decision it names and the reason it gives. */
type Output = {
  decision: string;
  reason: string;
} | null;

/** Writes a transcript file and returns its path. */
function transcript(name: string, lines: string[]): string {
  const path = join(dir, name);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join('\n'));

  return path;
}

const BOTH = [`{"text":"${SKILL_MARKER}"}`, `{"text":"${TYPESCRIPT_MARKER}"}`];
const BOUNDARY = '{"type":"system","subtype":"compact_boundary"}';

transcript('sub/abc/subagents/agent-a1.jsonl', BOTH);
transcript('sub2/abc/subagents/agent-a2.jsonl', []);

const CASES: {
  name: string;
  input: Record<string, unknown>;
  check: (output: Output) => string | null;
}[] = [
  {
    name: 'non-code file is silent',
    input: {
      tool_input: { file_path: '/repo/notes.md' },
      transcript_path: transcript('empty.jsonl', []),
    },
    check: output => (output === null ? null : 'expected silence'),
  },
  {
    name: 'empty transcript denies with both documents',
    input: {
      tool_input: { file_path: '/repo/app.ts' },
      transcript_path: transcript('empty.jsonl', []),
    },
    check: output =>
      expectDeny(output, [
        OPENING,
        `${SKILL_PATH}:`,
        SKILL_BODY_LINE,
        `${GUIDE_PATH}:`,
        TYPESCRIPT_MARKER,
      ]),
  },
  {
    name: 'transcript with both markers is silent',
    input: {
      tool_input: { file_path: '/repo/app.ts' },
      transcript_path: transcript('both.jsonl', BOTH),
    },
    check: output => (output === null ? null : 'expected silence'),
  },
  {
    name: 'transcript with the SKILL.md marker denies with the guide only',
    input: {
      tool_input: { file_path: '/repo/app.ts' },
      transcript_path: transcript('skill-only.jsonl', [BOTH[0]]),
    },
    check: output =>
      expectDeny(
        output,
        [`${GUIDE_PATH}:`, TYPESCRIPT_MARKER],
        [SKILL_BODY_LINE],
      ),
  },
  {
    name: 'markers before a compact boundary deny',
    input: {
      tool_input: { file_path: '/repo/app.ts' },
      transcript_path: transcript('compacted.jsonl', [...BOTH, BOUNDARY]),
    },
    check: output => expectDeny(output, [SKILL_BODY_LINE, TYPESCRIPT_MARKER]),
  },
  {
    name: 'markers after a compact boundary are silent',
    input: {
      tool_input: { file_path: '/repo/app.ts' },
      transcript_path: transcript('reloaded.jsonl', [BOUNDARY, ...BOTH]),
    },
    check: output => (output === null ? null : 'expected silence'),
  },
  {
    name: 'unreadable transcript is silent',
    input: {
      tool_input: { file_path: '/repo/app.ts' },
      transcript_path: join(dir, 'missing.jsonl'),
    },
    check: output => (output === null ? null : 'expected silence'),
  },
  {
    name: 'subagent reads its own transcript and is silent with the markers',
    input: {
      tool_input: { file_path: '/repo/app.ts' },
      transcript_path: transcript('sub/main.jsonl', []),
      session_id: 'abc',
      agent_id: 'a1',
    },
    check: output => (output === null ? null : 'expected silence'),
  },
  {
    name: 'subagent denies when only the main transcript holds the markers',
    input: {
      tool_input: { file_path: '/repo/app.ts' },
      transcript_path: transcript('sub2/main.jsonl', BOTH),
      session_id: 'abc',
      agent_id: 'agent-a2',
    },
    check: output => expectDeny(output, [SKILL_BODY_LINE, TYPESCRIPT_MARKER]),
  },
];

let failures = 0;

for (const { name, input, check } of CASES) {
  const failure = check(run(input));

  if (failure !== null) {
    failures++;
  }

  console.log(`${failure === null ? 'PASS' : 'FAIL'} ${name}`);

  if (failure !== null) {
    console.log(`  ${failure}`);
  }
}

console.log(failures === 0 ? 'All cases pass.' : `${failures} case(s) failed.`);

process.exit(failures === 0 ? 0 : 1);

/** Feeds one input through the hook as Claude Code would and returns the decision, or null for silence. */
function run(input: Record<string, unknown>): Output {
  const result = spawnSync('node', [script], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      ...input,
    }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
  });

  if (result.status !== 0) {
    throw new Error(`hook exited with ${result.status}: ${result.stderr}`);
  }

  if (result.stdout.trim() === '') {
    return null;
  }

  const { hookSpecificOutput } = JSON.parse(result.stdout);

  return {
    decision: `${hookSpecificOutput.hookEventName} ${hookSpecificOutput.permissionDecision}`,
    reason: hookSpecificOutput.permissionDecisionReason,
  };
}

/** Returns null for a deny whose reason holds every wanted text, is shorter than 10000 characters and holds no unwanted text. */
function expectDeny(
  output: Output,
  wanted: string[],
  unwanted: string[] = [],
): string | null {
  if (output === null) {
    return 'expected a deny, got silence';
  }

  if (output.decision !== 'PreToolUse deny') {
    return `expected PreToolUse deny, got ${output.decision}`;
  }

  if (output.reason.length >= 10000) {
    return `reason has ${output.reason.length} characters`;
  }

  const lacking = wanted.find(text => !output.reason.includes(text));

  if (lacking !== undefined) {
    return `reason lacks ${JSON.stringify(lacking)}`;
  }

  const present = unwanted.find(text => output.reason.includes(text));

  return present === undefined
    ? null
    : `reason holds ${JSON.stringify(present)}`;
}

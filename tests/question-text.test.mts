#!/usr/bin/env node

// Runs the question text hook against transcripts with and without text before the question and compares its decision with the expected one.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(
  root,
  'plugins',
  'forge',
  'hooks',
  'check-question-text.mts',
);

const dir = mkdtempSync(join(tmpdir(), 'question-text-'));

const REASON =
  'Write the facts and research this decision needs as text in the message first, then ask again. The user reads that text before the question and cannot see your thinking.';

const CALL = 'toolu_ask';

/** Builds one transcript record as Claude Code writes it, one content block per record. */
function record(role: 'user' | 'assistant', block: object): string {
  return JSON.stringify({ type: role, message: { role, content: [block] } });
}

const prompt = record('user', { type: 'text', text: 'Which one?' });
const result = record('user', { type: 'tool_result', content: 'done' });
const thinking = record('assistant', { type: 'thinking', thinking: 'hm' });
const read = record('assistant', { type: 'tool_use', id: 'toolu_read' });
const ask = record('assistant', { type: 'tool_use', id: CALL });
const noise = JSON.stringify({ type: 'attachment' });

const text = (value: string) =>
  record('assistant', { type: 'text', text: value });

/** What the hook printed, the decision it names and the reason it gives. */
type Output = {
  decision: string;
  reason: string;
} | null;

/** Parses the output of the hook, null for the silence of an allowed call. */
function parse(stdout: string): Output {
  if (stdout.trim() === '') {
    return null;
  }

  const output = JSON.parse(stdout).hookSpecificOutput;

  return {
    decision: output.permissionDecision,
    reason: output.permissionDecisionReason,
  };
}

/** Writes a transcript file and returns its path. */
function transcript(name: string, lines: string[]): string {
  const path = join(dir, name);

  writeFileSync(path, lines.join('\n'));

  return path;
}

const CASES: {
  name: string;
  lines: string[];
  expected: Output;
}[] = [
  {
    name: 'text before the question is silent',
    lines: [prompt, thinking, text('Facts: A costs 2.'), ask],
    expected: null,
  },
  {
    name: 'thinking and the call alone are denied',
    lines: [prompt, thinking, ask],
    expected: { decision: 'deny', reason: REASON },
  },
  {
    name: 'empty text is denied',
    lines: [prompt, text('  \n'), ask],
    expected: { decision: 'deny', reason: REASON },
  },
  {
    name: 'text before an earlier tool result is denied',
    lines: [prompt, text('Reading.'), read, result, thinking, ask],
    expected: { decision: 'deny', reason: REASON },
  },
  {
    name: 'text after the last tool result is silent',
    lines: [prompt, read, result, noise, text('Facts.'), noise, ask],
    expected: null,
  },
  {
    name: 'text before a parallel tool call of the same message is silent',
    lines: [prompt, text('Facts.'), read, ask],
    expected: null,
  },
  {
    name: 'a record after the call does not count',
    lines: [prompt, ask, text('Too late.')],
    expected: { decision: 'deny', reason: REASON },
  },
  {
    name: 'the question straight after the prompt is denied',
    lines: [prompt, ask],
    expected: { decision: 'deny', reason: REASON },
  },
];

/** Runs the hook on the input and returns what it printed. */
function run(input: Record<string, unknown>): Output {
  const result = spawnSync('node', [script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 15000,
  });

  return parse(result.stdout);
}

/** Runs the hook while a writer appends the call to the transcript after the hook has started. */
function runBeforeCallIsWritten(lines: string[]): Promise<Output> {
  const path = transcript('late.jsonl', lines.slice(0, -1));
  const child = spawn('node', [script], { stdio: ['pipe', 'pipe', 'inherit'] });
  let stdout = '';

  child.stdout.on('data', chunk => (stdout += chunk));
  child.stdin.end(JSON.stringify({ transcript_path: path, tool_use_id: CALL }));

  setTimeout(() => writeFileSync(path, lines.join('\n')), 300);

  return new Promise(done => child.on('close', () => done(parse(stdout))));
}

const failures: string[] = [];

/** Records a failure when the actual output differs from the expected one. */
function expectOutput(name: string, actual: Output, expected: Output): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

for (const { name, lines, expected } of CASES) {
  const path = transcript('case.jsonl', lines);

  expectOutput(
    name,
    run({ transcript_path: path, tool_use_id: CALL }),
    expected,
  );
}

expectOutput(
  'transcript that cannot be read is silent',
  run({ transcript_path: join(dir, 'missing.jsonl'), tool_use_id: CALL }),
  null,
);

expectOutput(
  'input without a transcript is silent',
  run({ tool_use_id: CALL }),
  null,
);

expectOutput(
  'input without a call id is silent',
  run({ transcript_path: transcript('id.jsonl', [prompt, ask]) }),
  null,
);

expectOutput(
  'transcript that never shows the call is silent',
  run({
    transcript_path: transcript('never.jsonl', [prompt, thinking]),
    tool_use_id: CALL,
  }),
  null,
);

expectOutput(
  'call written after the hook started is denied without text',
  await runBeforeCallIsWritten([prompt, thinking, ask]),
  { decision: 'deny', reason: REASON },
);

expectOutput(
  'call written after the hook started is silent with text',
  await runBeforeCallIsWritten([prompt, thinking, text('Facts.'), ask]),
  null,
);

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`question text hook: ${CASES.length + 7} cases passed`);

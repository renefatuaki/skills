#!/usr/bin/env node

// Runs the diagram labels hook against gh commands with and without the SVG label line and compares its decision with the expected one.

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(
  root,
  'plugins',
  'forge',
  'hooks',
  'check-diagram-labels.mts',
);

const SVG_LABELS = '%%{init: {"htmlLabels": false}}%%';

const REASON = `This text draws 1 diagram with HTML labels, which Safari and Chrome cut off. Put ${SVG_LABELS} on the line before the keyword of each flowchart, stateDiagram-v2 and classDiagram, then repeat the command.`;

const CASES: { name: string; command: string; expected: string | null }[] = [
  {
    name: 'pull request body with a flowchart without the line is denied',
    command: pullRequest(['flowchart TD', '  a["Load"] --> b["Show"]']),
    expected: REASON,
  },
  {
    name: 'pull request body with a flowchart with the line is silent',
    command: pullRequest([
      SVG_LABELS,
      'flowchart TD',
      '  a["Load"] --> b["Show"]',
    ]),
    expected: null,
  },
  {
    name: 'issue body with a state diagram without the line is denied',
    command: [
      'gh issue create --title "feat: sync" --body-file - <<\'EOF\'',
      '```mermaid',
      'stateDiagram-v2',
      '  [*] --> Idle',
      '```',
      'EOF',
    ].join('\n'),
    expected: REASON,
  },
  {
    name: 'pull request body with a sequence diagram is silent',
    command: pullRequest(['sequenceDiagram', '  App->>Bank: Load']),
    expected: null,
  },
  {
    name: 'pull request body without a diagram is silent',
    command: 'gh pr create --title "fix: typo" --body "Fixes a typo."',
    expected: null,
  },
  {
    name: 'command other than gh is silent',
    command: [
      "cat > notes.md <<'EOF'",
      '```mermaid',
      'flowchart TD',
      '  a --> b',
      '```',
      'EOF',
    ].join('\n'),
    expected: null,
  },
];

let failures = 0;

for (const { name, command, expected } of CASES) {
  const actual = run(command);
  const passed = actual === expected;

  if (!passed) {
    failures++;
  }

  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);

  if (!passed) {
    console.log(`  expected ${expected ?? 'silence'}`);
    console.log(`  got ${actual ?? 'silence'}`);
  }
}

console.log(failures === 0 ? 'All cases pass.' : `${failures} case(s) failed.`);

process.exit(failures === 0 ? 0 : 1);

/** Writes the gh command that opens a pull request whose body holds the diagram. */
function pullRequest(diagram: string[]): string {
  return [
    'gh pr create --base dev --title "feat: sync" --body-file - <<\'EOF\'',
    '## Diagram',
    '',
    '```mermaid',
    ...diagram,
    '```',
    'EOF',
  ].join('\n');
}

/** Feeds one Bash command through the hook as Claude Code would and returns the reason of its denial, or null for silence. */
function run(command: string): string | null {
  const result = spawnSync('node', [script], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command },
    }),
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`hook exited with ${result.status}: ${result.stderr}`);
  }

  if (result.stdout.trim() === '') {
    return null;
  }

  const { hookSpecificOutput } = JSON.parse(result.stdout);

  return hookSpecificOutput.permissionDecisionReason;
}

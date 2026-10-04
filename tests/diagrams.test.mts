#!/usr/bin/env node

// Runs the diagram check hook over the fixture project, once with the Mermaid of this repository and once in a project without one, and compares the findings with the expected ones.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'hooks', 'check-diagrams.mts');
const fixture = join(root, 'tests', 'fixtures', 'diagrams');

const EXPECTED: Record<string, string[]> = {
  'README.md': [],
  'src/orders/README.md': [],
  'docs/architecture.md': [],
  'docs/types.md': [],
  'docs/edge.md': [],
  'notes.md': [],
  'docs/bad.md': ['docs/bad.md:10 syntax', 'docs/bad.md:21 syntax'],
  'docs/README.md': [],
  'docs/schema.sql': ['docs/README.md:5 linked'],
  'src/orders/checkout.ts': [
    'src/orders/README.md:5 linked',
    'docs/architecture.md:5 linked',
    'docs/bad.md:5 linked',
    'docs/types.md:28 linked',
  ],
  'src/orders/payment.ts': ['src/orders/README.md:5 linked'],
  'src/orders/edge.ts': [
    'docs/edge.md:5 linked',
    'docs/edge.md:23 linked',
    'docs/edge.md:46 linked',
    'docs/edge.md:56 linked',
  ],
  'src/orders/unlinked.ts': [],
  'docs/missing.md': [],
};

/** The lines that open the two lists of the hook output, every other line is a finding. */
const HEADINGS = [
  'Mermaid (diagrams skill) cannot parse the last edit.',
  'Diagrams (diagrams skill) link ',
];

/** What the hook reports where the project has no Mermaid to parse with, no syntax finding and the same links. */
const EXPECTED_WITHOUT_MERMAID: Record<string, string[]> = {
  'docs/bad.md': [],
  'src/orders/checkout.ts': EXPECTED['src/orders/checkout.ts'],
};

// A folder outside this repository resolves no Mermaid, inside it Node finds the one of the repository.
const bare = mkdtempSync(join(tmpdir(), 'diagrams-'));

cpSync(fixture, bare, { recursive: true });

const failures =
  compare('diagrams', fixture, EXPECTED) +
  compare('diagrams-without-mermaid', bare, EXPECTED_WITHOUT_MERMAID);

rmSync(bare, { recursive: true });

console.log(
  failures === 0 ? 'All fixtures pass.' : `${failures} fixture(s) failed.`,
);

process.exit(failures === 0 ? 0 : 1);

/** Runs every file of the project through the hook, prints one line per file and returns the number of mismatches. */
function compare(
  label: string,
  project: string,
  files: Record<string, string[]>,
): number {
  let mismatches = 0;

  for (const [name, expected] of Object.entries(files)) {
    const actual = run(project, name);
    const ok = JSON.stringify(actual) === JSON.stringify(expected);

    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}/${name}`);

    if (!ok) {
      mismatches++;
      console.log(
        `  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`,
      );
    }
  }

  return mismatches;
}

/** Feeds one file through the hook with its project as working directory and returns "path:line rule" entries. */
function run(project: string, filePath: string): string[] {
  const input = JSON.stringify({
    cwd: project,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: filePath },
  });

  const result = spawnSync('node', [script], { input, encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(`hook exited with ${result.status}: ${result.stderr}`);
  }

  if (result.stdout.trim() === '') {
    return [];
  }

  const context: string = JSON.parse(result.stdout).hookSpecificOutput
    .additionalContext;

  return context.split('\n').flatMap(line => {
    const match = line.match(/^(\S+:\d+ \S+)/);

    if (match) {
      return [match[1]];
    }

    if (HEADINGS.some(heading => line.startsWith(heading))) {
      return [];
    }

    throw new Error(`unexpected line in the hook output: ${line}`);
  });
}

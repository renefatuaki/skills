#!/usr/bin/env node

// Runs the comment rules over every fixture and compares the findings with the expected ones.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { comments } from '../hooks/lib/comments.mts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'tests', 'fixtures');

const EXPECTED: Record<string, string[]> = {
  'bad.swift': ['3 em-dash', '6 semicolon', '9 too-long', '14 todo-link'],
  'good.swift': [],
  'bad.py': ['3 em-dash', '7 semicolon', '10 too-long', '16 todo-link'],
  'good.py': [],
  'bad.ts': ['3 em-dash', '6 semicolon', '10 too-long', '16 todo-link'],
  'good.ts': [],
  'bad.kt': ['3 em-dash', '6 semicolon', '10 too-long', '16 todo-link'],
  'good.kt': [],
  'bad.java': ['3 em-dash', '6 semicolon', '10 too-long', '16 todo-link'],
  'good.java': [],
  'notes.md': [],
  'missing.swift': [],
};

let failures = 0;

for (const [name, expected] of Object.entries(EXPECTED)) {
  const actual = await run(join(fixtures, name));
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

console.log(
  failures === 0 ? 'All fixtures pass.' : `${failures} fixture(s) failed.`,
);

process.exit(failures === 0 ? 0 : 1);

/** Checks one fixture as the turn hook checks a changed file and returns "line rule" pairs. */
async function run(file: string): Promise<string[]> {
  const findings = await comments.check({ root: fixtures, files: [file] });

  return findings.map(finding => `${finding.line} ${finding.rule}`);
}

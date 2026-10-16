#!/usr/bin/env node

// Runs the prefill-url script with an issue on stdin and compares its output and exit code with the expected ones.

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(
  root,
  'skills',
  'github',
  'issue',
  'scripts',
  'prefill-url.mts',
);

/** What the script prints on stdout, the code it exits with, and its message on stderr, which a case expects empty or containing a part. */
type Result = {
  stdout: string;
  status: number | null;
  message: string;
};

const CASES: {
  name: string;
  issue: object;
  expected: Result;
}[] = [
  {
    name: 'a form with its fields',
    issue: {
      repo: 'octo/repo',
      template: 'bug.yml',
      title: 'Crash on start',
      fields: { description: 'It crashes.' },
      assignees: ['octo'],
    },
    expected: {
      stdout:
        'https://github.com/octo/repo/issues/new?template=bug.yml&title=Crash%20on%20start&description=It%20crashes.&assignees=octo',
      status: 0,
      message: '',
    },
  },
  {
    name: 'a blank issue with its body and labels',
    issue: {
      repo: 'octo/repo',
      title: 'Crash on start',
      body: '### Describe the bug\n\nIt crashes.',
      labels: ['bug', 'app: web'],
    },
    expected: {
      stdout:
        'https://github.com/octo/repo/issues/new?title=Crash%20on%20start&body=%23%23%23%20Describe%20the%20bug%0A%0AIt%20crashes.&labels=bug%2Capp%3A%20web',
      status: 0,
      message: '',
    },
  },
  {
    name: 'neither template nor body',
    issue: { repo: 'octo/repo', title: 'Crash on start' },
    expected: {
      stdout: '',
      status: 2,
      message: 'give either template or body',
    },
  },
  {
    name: 'both template and body',
    issue: {
      repo: 'octo/repo',
      title: 'Crash on start',
      template: 'bug.yml',
      body: 'It crashes.',
    },
    expected: {
      stdout: '',
      status: 2,
      message: 'give either template or body',
    },
  },
  {
    name: 'a body above the limit',
    issue: { repo: 'octo/repo', title: 'Long', body: 'x'.repeat(7000) },
    expected: { stdout: '', status: 1, message: 'the limit is 7000' },
  },
];

let failures = 0;

for (const { name, issue, expected } of CASES) {
  const actual = run(issue);
  const ok =
    actual.stdout === expected.stdout &&
    actual.status === expected.status &&
    (expected.message === ''
      ? actual.message === ''
      : actual.message.includes(expected.message));

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

function run(issue: object): Result {
  const result = spawnSync('node', [script], {
    input: JSON.stringify(issue),
    encoding: 'utf8',
  });

  return {
    stdout: result.stdout.trim(),
    status: result.status,
    message: result.stderr.trim(),
  };
}

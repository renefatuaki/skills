#!/usr/bin/env node

// Runs the tick-criteria script against a stand-in gh that serves one issue body per case and compares the body it writes back and what it prints with the expected ones.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(
  root,
  'skills',
  'github',
  'issue',
  'scripts',
  'tick-criteria.mts',
);

const fakeGh = join(root, 'tests', 'fixtures', 'tick-criteria', 'bin');

const ISSUE = 'https://github.com/acme/app/issues/10';

/** What the script prints on stdout, the code it exits with, the body it writes back or null when it writes none, and its message on stderr, which a case expects empty or containing a part. */
type Result = {
  stdout: string;
  status: number | null;
  edited: string | null;
  message: string;
};

const FEATURE = [
  "### Describe the solution you'd like",
  '',
  '- [ ] not a criterion',
  '',
  '### Acceptance criteria',
  '',
  '- [ ] Given a cart, when the user pays, then the order is saved',
  '  - [ ] nested note',
  '- [x] The receipt is mailed',
  '- [ ] The total shows tax',
  '',
  '### Out of scope',
  '',
  '- [ ] not a criterion either',
].join('\n');

const CASES: {
  name: string;
  args: string[];
  body: string;
  expected: Result;
}[] = [
  {
    name: 'a criterion is ticked and the rest of the body stays as it is',
    args: ['--criteria', '1'],
    body: FEATURE,
    expected: edited(
      FEATURE.replace('- [ ] Given a cart', '- [x] Given a cart'),
      '1 ticked\n2 ticked\n3 open',
    ),
  },
  {
    name: 'a criterion already ticked writes nothing back',
    args: ['--criteria', '2'],
    body: FEATURE,
    expected: unchanged('1 open\n2 ticked\n3 open'),
  },
  {
    name: 'a tick set by hand stays when other criteria are ticked',
    args: ['--criteria', '1,3'],
    body: FEATURE,
    expected: edited(
      FEATURE.replace('- [ ] Given a cart', '- [x] Given a cart').replace(
        '- [ ] The total',
        '- [x] The total',
      ),
      '1 ticked\n2 ticked\n3 ticked',
    ),
  },
  {
    name: 'every success criterion of an epic is ticked',
    args: ['--all'],
    body: '### Goal\n\nShip it.\n\n### Success criteria\n\n- [ ] One\n* [ ] Two',
    expected: edited(
      '### Goal\n\nShip it.\n\n### Success criteria\n\n- [x] One\n* [x] Two',
      '1 ticked\n2 ticked',
    ),
  },
  {
    name: 'a Done when list of a chore is ticked',
    args: ['--criteria', '2'],
    body: '### Goal\n\nTidy.\n\n### Done when\n\n- [ ] A\n- [ ] B',
    expected: edited(
      '### Goal\n\nTidy.\n\n### Done when\n\n- [ ] A\n- [x] B',
      '1 open\n2 ticked',
    ),
  },
  {
    name: 'a criterion the body lacks fails without writing',
    args: ['--criteria', '4'],
    body: FEATURE,
    expected: failed('The issue has no criterion 4.'),
  },
  {
    name: 'a body without a criteria checkbox fails without writing',
    args: ['--all'],
    body: '### Describe the bug\n\nIt breaks.\n\n### Expected behavior\n\nIt works.',
    expected: failed('The issue has no checkbox'),
  },
  {
    name: 'both selections at once fail',
    args: ['--criteria', '1', '--all'],
    body: FEATURE,
    expected: failed('usage: tick-criteria.mts'),
  },
  {
    name: 'no selection fails',
    args: [],
    body: FEATURE,
    expected: failed('usage: tick-criteria.mts'),
  },
];

let failures = 0;

for (const { name, args, body, expected } of CASES) {
  const actual = run([ISSUE, ...args], body);
  const passed =
    actual.stdout === expected.stdout &&
    actual.status === expected.status &&
    actual.edited === expected.edited &&
    (expected.message === ''
      ? actual.message === ''
      : actual.message.includes(expected.message));

  if (!passed) {
    failures++;
  }

  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);

  if (!passed) {
    console.log(
      `  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`,
    );
  }
}

console.log(failures === 0 ? 'All cases pass.' : `${failures} case(s) failed.`);

process.exit(failures === 0 ? 0 : 1);

/** Starts the script with the stand-in gh first on the PATH, serving the body of the case, and reads back what it wrote. */
function run(args: string[], body: string): Result {
  const directory = mkdtempSync(join(tmpdir(), 'tick-criteria-'));
  const edit = join(directory, 'body.md');

  try {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeGh}:${process.env.PATH}`,
        FAKE_GH_BODY: body,
        FAKE_GH_EDIT: edit,
      },
    });

    return {
      stdout: result.stdout.trim(),
      status: result.status,
      edited: existsSync(edit) ? readFileSync(edit, 'utf8') : null,
      message: result.stderr,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function edited(body: string, stdout: string): Result {
  return { stdout, status: 0, edited: body, message: '' };
}

function unchanged(stdout: string): Result {
  return { stdout, status: 0, edited: null, message: '' };
}

function failed(message: string): Result {
  return { stdout: '', status: 1, edited: null, message };
}

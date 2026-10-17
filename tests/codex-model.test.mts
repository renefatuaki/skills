#!/usr/bin/env node

// Runs the codex-model script against a stand-in Codex app-server and compares its output and exit code with the expected ones.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(
  root,
  'skills',
  'workflow',
  'engineering',
  'scripts',
  'codex-model.mts',
);

const fakeCodex = join(root, 'tests', 'fixtures', 'codex', 'bin');

/** A home without a rule file, so a case reads the minimum of 20 unless it names another home. */
const homeWithoutRules = join(root, 'tests', 'fixtures', 'codex');

/** A home whose ~/.claude/rules/models.md holds `codex minimum: 30%`, written fresh because the repository ignores every .claude folder. */
const homeWithRules = mkdtempSync(join(tmpdir(), 'codex-model-home-'));

mkdirSync(join(homeWithRules, '.claude', 'rules'), { recursive: true });
writeFileSync(
  join(homeWithRules, '.claude', 'rules', 'models.md'),
  'codex minimum: 30%\n',
);

/** What the script prints on stdout, the code it exits with, and its message on stderr, which a case expects empty or containing a part. */
type Result = {
  stdout: string;
  status: number | null;
  message: string;
};

const CASES: {
  name: string;
  args: string[];
  env: Record<string, string>;
  expected: Result;
}[] = [
  {
    name: 'the newest version of a name, on the second page',
    args: ['sol'],
    env: { PATH: `${fakeCodex}:${process.env.PATH}` },
    expected: { stdout: 'gpt-6.1-sol', status: 0, message: '' },
  },
  {
    name: 'an older version on the second page left out',
    args: ['astra'],
    env: { PATH: `${fakeCodex}:${process.env.PATH}` },
    expected: { stdout: 'gpt-6-astra', status: 0, message: '' },
  },
  {
    name: 'a hidden model left out',
    args: ['luna'],
    env: { PATH: `${fakeCodex}:${process.env.PATH}` },
    expected: { stdout: 'gpt-6-luna', status: 0, message: '' },
  },
  {
    name: 'a name that is no Codex model',
    args: ['terra'],
    env: { PATH: `${fakeCodex}:${process.env.PATH}` },
    expected: { stdout: '', status: 1, message: 'usage: codex-model.mts' },
  },
  {
    name: 'a Codex model the app-server does not list',
    args: ['sol'],
    env: { PATH: `${fakeCodex}:${process.env.PATH}`, FAKE_CODEX_EMPTY: '1' },
    expected: {
      stdout: '',
      status: 1,
      message: 'lists no model named sol',
    },
  },
  {
    name: 'an error from the app-server',
    args: ['sol'],
    env: { PATH: `${fakeCodex}:${process.env.PATH}`, FAKE_CODEX_ERROR: '1' },
    expected: { stdout: '', status: 1, message: 'refused: restart Codex' },
  },
  {
    name: 'an app-server that exits before it answers',
    args: ['sol'],
    env: { PATH: `${fakeCodex}:${process.env.PATH}`, FAKE_CODEX_EXIT: '1' },
    expected: { stdout: '', status: 1, message: 'exited with code 2' },
  },
  {
    name: 'an app-server that quits after initialize',
    args: ['sol'],
    env: { PATH: `${fakeCodex}:${process.env.PATH}`, FAKE_CODEX_QUIT: '1' },
    expected: { stdout: '', status: 1, message: 'exited with code 3' },
  },
  {
    name: 'a line that is no JSON',
    args: ['sol'],
    env: { PATH: `${fakeCodex}:${process.env.PATH}`, FAKE_CODEX_NOISE: '1' },
    expected: { stdout: '', status: 1, message: 'a line that is no JSON' },
  },
  {
    name: 'a reached usage limit',
    args: ['sol'],
    env: {
      PATH: `${fakeCodex}:${process.env.PATH}`,
      FAKE_CODEX_USAGE: 'reached',
    },
    expected: { stdout: '', status: 1, message: 'reached its usage limit' },
  },
  {
    name: 'less than the minimum left of the weekly window',
    args: ['sol'],
    env: { PATH: `${fakeCodex}:${process.env.PATH}`, FAKE_CODEX_USAGE: 'low' },
    expected: {
      stdout: '',
      status: 1,
      message: '15 % left of its 7-day usage window, below the minimum of 20 %',
    },
  },
  {
    name: 'exactly the minimum left',
    args: ['sol'],
    env: {
      PATH: `${fakeCodex}:${process.env.PATH}`,
      FAKE_CODEX_USAGE: 'enough',
    },
    expected: { stdout: 'gpt-6.1-sol', status: 0, message: '' },
  },
  {
    name: 'a lower minimum from the command line',
    args: ['--min-remaining', '10', 'sol'],
    env: { PATH: `${fakeCodex}:${process.env.PATH}`, FAKE_CODEX_USAGE: 'low' },
    expected: { stdout: 'gpt-6.1-sol', status: 0, message: '' },
  },
  {
    name: 'a reached usage limit with no minimum',
    args: ['--min-remaining', '0', 'sol'],
    env: {
      PATH: `${fakeCodex}:${process.env.PATH}`,
      FAKE_CODEX_USAGE: 'reached',
    },
    expected: { stdout: '', status: 1, message: 'reached its usage limit' },
  },
  {
    name: 'a minimum that is no percent',
    args: ['--min-remaining', '120', 'sol'],
    env: { PATH: `${fakeCodex}:${process.env.PATH}` },
    expected: { stdout: '', status: 1, message: 'usage: codex-model.mts' },
  },
  {
    name: 'an unknown option',
    args: ['--minimum', '10', 'sol'],
    env: { PATH: `${fakeCodex}:${process.env.PATH}` },
    expected: { stdout: '', status: 1, message: 'usage: codex-model.mts' },
  },
  {
    name: 'a reached usage limit that credits pay for',
    args: ['sol'],
    env: {
      PATH: `${fakeCodex}:${process.env.PATH}`,
      FAKE_CODEX_USAGE: 'credits',
    },
    expected: { stdout: 'gpt-6.1-sol', status: 0, message: '' },
  },
  {
    name: 'an account without usage limits',
    args: ['sol'],
    env: {
      PATH: `${fakeCodex}:${process.env.PATH}`,
      FAKE_CODEX_USAGE: 'apikey',
    },
    expected: { stdout: 'gpt-6.1-sol', status: 0, message: '' },
  },
  {
    name: 'no Codex CLI',
    args: ['sol'],
    env: { PATH: join(root, 'tests', 'fixtures', 'codex') },
    expected: { stdout: '', status: 1, message: 'is not installed' },
  },
  {
    name: 'the minimum of the codex minimum line',
    args: ['sol'],
    env: {
      PATH: `${fakeCodex}:${process.env.PATH}`,
      HOME: homeWithRules,
      FAKE_CODEX_USAGE: 'enough',
    },
    expected: {
      stdout: '',
      status: 1,
      message: '20 % left of its 7-day usage window, below the minimum of 30 %',
    },
  },
  {
    name: 'the usage left of both windows',
    args: ['--usage'],
    env: { PATH: `${fakeCodex}:${process.env.PATH}` },
    expected: {
      stdout: '{"primary":100,"secondary":100,"belowMinimum":false}',
      status: 0,
      message: '',
    },
  },
  {
    name: 'the usage of a reached limit that credits pay for, below the minimum all the same',
    args: ['--usage'],
    env: {
      PATH: `${fakeCodex}:${process.env.PATH}`,
      FAKE_CODEX_USAGE: 'credits',
    },
    expected: {
      stdout: '{"primary":100,"secondary":0,"belowMinimum":true}',
      status: 0,
      message: '',
    },
  },
  {
    name: 'the usage judged against the codex minimum line',
    args: ['--usage'],
    env: {
      PATH: `${fakeCodex}:${process.env.PATH}`,
      HOME: homeWithRules,
      FAKE_CODEX_USAGE: 'enough',
    },
    expected: {
      stdout: '{"primary":100,"secondary":20,"belowMinimum":true}',
      status: 0,
      message: '',
    },
  },
];

let failures = 0;

for (const { name, args, env, expected } of CASES) {
  const actual = run(args, env);
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

rmSync(homeWithRules, { recursive: true });

console.log(failures === 0 ? 'All cases pass.' : `${failures} case(s) failed.`);

process.exit(failures === 0 ? 0 : 1);

/** Starts the script with the environment of the case, whose PATH decides which `codex` it finds. */
function run(args: string[], env: Record<string, string>): Result {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: homeWithoutRules, ...env },
  });

  return {
    stdout: result.stdout.trim(),
    status: result.status,
    message: result.stderr,
  };
}

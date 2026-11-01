#!/usr/bin/env node

// Runs the antigravity-model script against a stand-in Antigravity CLI and compares its output and exit code with the expected ones.

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
  'antigravity-model.mts',
);

const fakeAgy = join(root, 'tests', 'fixtures', 'antigravity', 'bin');

const withFakeAgy = { PATH: `${fakeAgy}:${process.env.PATH}` };

const scratch = mkdtempSync(join(tmpdir(), 'antigravity-test-'));

/** A home without a rule file, so a case reads the minimum of 20 unless it names another home. */
const homeWithoutRules = join(scratch, 'home-without-rules');

/** A home whose ~/.claude/rules/models.md holds `antigravity minimum: 30%`, written fresh because the repository ignores every .claude folder. */
const homeWithRules = join(scratch, 'home-with-rules');

mkdirSync(homeWithoutRules, { recursive: true });
mkdirSync(join(homeWithRules, '.claude', 'rules'), { recursive: true });
writeFileSync(
  join(homeWithRules, '.claude', 'rules', 'models.md'),
  'effort: fixed\ncodex minimum: 10%\nantigravity minimum: 30%\n',
);

/** What the script prints on stdout, the code it exits with, and its message on stderr, which a case expects empty or containing a part. */
type Result = {
  stdout: string;
  status: number | null;
  message: string;
};

type Case = {
  name: string;
  args: string[];
  env?: Record<string, string>;
  home?: string;
  expected: Result;
};

const USAGE_MESSAGE = 'usage: antigravity-model.mts';

const CASES: Case[] = [
  {
    name: 'the newest version, compared part by part',
    args: ['flash', 'high'],
    expected: { stdout: 'gemini-3.10-flash-high', status: 0, message: '' },
  },
  {
    name: 'the effort asked for in the newest version',
    args: ['flash', 'medium'],
    expected: { stdout: 'gemini-3.10-flash-medium', status: 0, message: '' },
  },
  {
    name: 'the nearest effort of the newest version, though an older version lists the effort',
    args: ['flash', 'low'],
    expected: {
      stdout: 'gemini-3.10-flash-medium',
      status: 0,
      message:
        'Antigravity lists no gemini-3.10-flash with the effort low, so it runs gemini-3.10-flash-medium.',
    },
  },
  {
    name: 'the nearest lower effort for xhigh',
    args: ['flash', 'xhigh'],
    expected: {
      stdout: 'gemini-3.10-flash-high',
      status: 0,
      message: 'with the effort xhigh, so it runs gemini-3.10-flash-high.',
    },
  },
  {
    name: 'the effort asked for, when the model lists it',
    args: ['argon', 'high'],
    expected: { stdout: 'gemini-4-argon-high', status: 0, message: '' },
  },
  {
    name: 'the nearest higher effort for an effort below the lowest listed',
    args: ['argon', 'low'],
    expected: {
      stdout: 'gemini-4-argon-medium',
      status: 0,
      message:
        'Antigravity lists no gemini-4-argon with the effort low, so it runs gemini-4-argon-medium.',
    },
  },
  {
    name: 'the highest listed effort for max',
    args: ['argon', 'max'],
    expected: {
      stdout: 'gemini-4-argon-high',
      status: 0,
      message:
        'Antigravity lists no gemini-4-argon with the effort max, so it runs gemini-4-argon-high.',
    },
  },
  {
    name: 'the lower effort of two at the same distance',
    args: ['pro', 'medium'],
    expected: {
      stdout: 'gemini-3.1-pro-low',
      status: 0,
      message: 'so it runs gemini-3.1-pro-low.',
    },
  },
  {
    name: 'a slug on a line aligned with spaces',
    args: ['pro', 'high'],
    expected: { stdout: 'gemini-3.1-pro-high', status: 0, message: '' },
  },
  {
    name: 'a model the CLI lists only as an id without an effort',
    args: ['carbon', 'high'],
    expected: {
      stdout: '',
      status: 1,
      message:
        'lists no model named carbon. The account may lack the tier that includes it.',
    },
  },
  {
    name: 'a name that is no Antigravity model',
    args: ['ultra', 'high'],
    expected: { stdout: '', status: 1, message: USAGE_MESSAGE },
  },
  {
    name: 'an effort that is no Antigravity effort',
    args: ['flash', 'ultra'],
    expected: { stdout: '', status: 1, message: USAGE_MESSAGE },
  },
  {
    name: 'a name without an effort',
    args: ['flash'],
    expected: { stdout: '', status: 1, message: USAGE_MESSAGE },
  },
  {
    name: '--run, which the script no longer knows',
    args: ['--run', 'flash', 'high'],
    expected: { stdout: '', status: 1, message: USAGE_MESSAGE },
  },
  {
    name: '--timeout, which the script no longer knows',
    args: ['--timeout', '5', 'flash', 'high'],
    expected: { stdout: '', status: 1, message: USAGE_MESSAGE },
  },
  {
    name: 'a minimum that is no percent',
    args: ['--min-remaining', '101', 'flash', 'high'],
    expected: { stdout: '', status: 1, message: USAGE_MESSAGE },
  },
  {
    name: '--usage with a model name',
    args: ['--usage', 'flash', 'high'],
    expected: { stdout: '', status: 1, message: USAGE_MESSAGE },
  },
  {
    name: 'no Antigravity CLI',
    args: ['flash', 'high'],
    env: { PATH: join(root, 'tests', 'fixtures', 'antigravity') },
    expected: { stdout: '', status: 1, message: 'is not installed' },
  },
  {
    name: 'no Antigravity CLI for --usage',
    args: ['--usage'],
    env: { PATH: join(root, 'tests', 'fixtures', 'antigravity') },
    expected: { stdout: '', status: 1, message: 'is not installed' },
  },
  {
    name: 'a CLI that is not signed in',
    args: ['flash', 'high'],
    env: { FAKE_AGY_CASE: 'signed-out' },
    expected: { stdout: '', status: 1, message: 'Sign in with `agy`' },
  },
  {
    name: 'enough usage left, with a tight group of other models ignored',
    args: ['flash', 'high'],
    expected: {
      stdout: 'gemini-3.10-flash-high',
      status: 0,
      message: '',
    },
  },
  {
    name: 'less than the minimum left of the weekly limit',
    args: ['flash', 'high'],
    env: { FAKE_AGY_USAGE: 'below' },
    expected: {
      stdout: '',
      status: 1,
      message:
        'Antigravity has 15 % left of its weekly limit for Gemini Models, below the minimum of 20 %. It resets at 2026-11-06T15:01:23Z.',
    },
  },
  {
    name: 'exactly the minimum left',
    args: ['flash', 'high'],
    env: { FAKE_AGY_USAGE: 'exactly' },
    expected: {
      stdout: 'gemini-3.10-flash-high',
      status: 0,
      message: '',
    },
  },
  {
    name: 'a lower minimum from the command line',
    args: ['--min-remaining', '10', 'flash', 'high'],
    env: { FAKE_AGY_USAGE: 'below' },
    expected: {
      stdout: 'gemini-3.10-flash-high',
      status: 0,
      message: '',
    },
  },
  {
    name: 'a higher minimum from the command line',
    args: ['--min-remaining', '95', 'flash', 'high'],
    expected: {
      stdout: '',
      status: 1,
      message:
        '92 % left of its weekly limit for Gemini Models, below the minimum of 95 %.',
    },
  },
  {
    name: 'a minimum of 0, which no usage falls below',
    args: ['--min-remaining', '0', 'flash', 'high'],
    env: { FAKE_AGY_USAGE: 'below' },
    expected: {
      stdout: 'gemini-3.10-flash-high',
      status: 0,
      message: '',
    },
  },
  {
    name: 'the minimum of the antigravity minimum line',
    args: ['flash', 'high'],
    env: { FAKE_AGY_USAGE: 'exactly' },
    home: homeWithRules,
    expected: {
      stdout: '',
      status: 1,
      message:
        '20 % left of its weekly limit for Gemini Models, below the minimum of 30 %.',
    },
  },
  {
    name: 'a minimum of the command line over the antigravity minimum line',
    args: ['--min-remaining', '10', 'flash', 'high'],
    env: { FAKE_AGY_USAGE: 'exactly' },
    home: homeWithRules,
    expected: {
      stdout: 'gemini-3.10-flash-high',
      status: 0,
      message: '',
    },
  },
  {
    name: 'a model in a group of its own, which leaves the other group alone',
    args: ['flash', 'high'],
    env: { FAKE_AGY_USAGE: 'argon-group' },
    expected: {
      stdout: 'gemini-3.10-flash-high',
      status: 0,
      message: '',
    },
  },
  {
    name: 'a model in a group of its own, below the minimum',
    args: ['argon', 'high'],
    env: { FAKE_AGY_USAGE: 'argon-group' },
    expected: {
      stdout: '',
      status: 1,
      message:
        '10 % left of its weekly limit for Gemini Argon, below the minimum of 20 %.',
    },
  },
  {
    name: 'a Gemini group by its name, when no description lists the model',
    args: ['flash', 'high'],
    env: { FAKE_AGY_USAGE: 'plain' },
    expected: {
      stdout: '',
      status: 1,
      message: '10 % left of its weekly limit for Gemini Models',
    },
  },
  {
    name: 'the tightest of several limits of a group',
    args: ['pro', 'high'],
    env: { FAKE_AGY_USAGE: 'buckets' },
    expected: {
      stdout: '',
      status: 1,
      message: '10 % left of its weekly limit for Gemini Models',
    },
  },
  {
    name: 'a /usage that fails, so the slug is printed with a note',
    args: ['flash', 'high'],
    env: { FAKE_AGY_USAGE: 'fails' },
    expected: {
      stdout: 'gemini-3.10-flash-high',
      status: 0,
      message:
        'Antigravity reports no Gemini usage, so the run starts without a usage check. `agy -p /usage` exited with code 1 and reported no groups. quota service unreachable',
    },
  },
  {
    name: 'a /usage that prints no JSON, so the slug is printed with a note',
    args: ['flash', 'high'],
    env: { FAKE_AGY_USAGE: 'garbage' },
    expected: {
      stdout: 'gemini-3.10-flash-high',
      status: 0,
      message: 'so the run starts without a usage check.',
    },
  },
  {
    name: 'a /usage without a Gemini group, so the slug is printed with a note',
    args: ['flash', 'high'],
    env: { FAKE_AGY_USAGE: 'no-gemini' },
    expected: {
      stdout: 'gemini-3.10-flash-high',
      status: 0,
      message:
        'Antigravity reports no Gemini usage, so the run starts without a usage check.',
    },
  },
  {
    name: 'the usage left of the Gemini groups',
    args: ['--usage'],
    expected: {
      stdout: '{"groups":{"Gemini Models":92},"belowMinimum":false}',
      status: 0,
      message: '',
    },
  },
  {
    name: 'the usage left, below the minimum',
    args: ['--usage'],
    env: { FAKE_AGY_USAGE: 'below' },
    expected: {
      stdout: '{"groups":{"Gemini Models":15},"belowMinimum":true}',
      status: 0,
      message: '',
    },
  },
  {
    name: 'the usage left of a group of its own next to the shared group',
    args: ['--usage'],
    env: { FAKE_AGY_USAGE: 'argon-group' },
    expected: {
      stdout:
        '{"groups":{"Gemini Models":92,"Gemini Argon":10},"belowMinimum":true}',
      status: 0,
      message: '',
    },
  },
  {
    name: 'the usage left, judged against a lower minimum of the command line',
    args: ['--usage', '--min-remaining', '5'],
    env: { FAKE_AGY_USAGE: 'argon-group' },
    expected: {
      stdout:
        '{"groups":{"Gemini Models":92,"Gemini Argon":10},"belowMinimum":false}',
      status: 0,
      message: '',
    },
  },
  {
    name: 'the usage left, judged against the antigravity minimum line',
    args: ['--usage'],
    env: { FAKE_AGY_USAGE: 'exactly' },
    home: homeWithRules,
    expected: {
      stdout: '{"groups":{"Gemini Models":20},"belowMinimum":true}',
      status: 0,
      message: '',
    },
  },
  {
    name: 'the usage of a CLI whose /usage fails',
    args: ['--usage'],
    env: { FAKE_AGY_USAGE: 'fails' },
    expected: {
      stdout: '',
      status: 1,
      message:
        'exited with code 1 and reported no groups. quota service unreachable',
    },
  },
  {
    name: 'the usage of an account without a Gemini group',
    args: ['--usage'],
    env: { FAKE_AGY_USAGE: 'no-gemini' },
    expected: {
      stdout: '',
      status: 1,
      message: 'Antigravity reports no usage for a Gemini group.',
    },
  },
];

let failures = 0;

for (const testCase of CASES) {
  const { name, expected } = testCase;
  const actual = run(testCase);
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

rmSync(scratch, { recursive: true });

console.log(failures === 0 ? 'All cases pass.' : `${failures} case(s) failed.`);

process.exit(failures === 0 ? 0 : 1);

/** Starts the script with the arguments of the case. The PATH of the environment decides which `agy` the script finds. */
function run(testCase: Case): Result {
  const result = spawnSync(process.execPath, [script, ...testCase.args], {
    cwd: scratch,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...withFakeAgy,
      HOME: testCase.home ?? homeWithoutRules,
      ...testCase.env,
    },
  });

  return {
    stdout: result.stdout.trim(),
    status: result.status,
    message: result.stderr,
  };
}

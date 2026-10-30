#!/usr/bin/env node

// Runs the antigravity script against a stand-in Antigravity CLI and compares its output and exit code with the expected ones.

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  'antigravity.mts',
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

/** The folder a case runs in. A repo holds a committed file, and a dirty repo also holds an edit of it and an untracked file. */
type Tree = 'plain' | 'repo' | 'dirty-repo';

type Case = {
  name: string;
  args: string[];
  input?: string;
  env?: Record<string, string>;
  home?: string;
  tree?: Tree;
  runs?: number;
  expected: Result;
};

const USAGE_MESSAGE = 'usage: antigravity.mts';

const BRIEF = 'Review the diff.';

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
    name: 'a timeout without --run',
    args: ['--timeout', '5', 'flash', 'high'],
    expected: { stdout: '', status: 1, message: USAGE_MESSAGE },
  },
  {
    name: 'a timeout that is no whole number of minutes',
    args: ['--run', '--timeout', '0', 'flash', 'high'],
    input: BRIEF,
    expected: { stdout: '', status: 1, message: USAGE_MESSAGE },
  },
  {
    name: 'a minimum without --run or --usage',
    args: ['--min-remaining', '10', 'flash', 'high'],
    expected: { stdout: '', status: 1, message: USAGE_MESSAGE },
  },
  {
    name: 'a minimum that is no percent',
    args: ['--run', '--min-remaining', '101', 'flash', 'high'],
    input: BRIEF,
    expected: { stdout: '', status: 1, message: USAGE_MESSAGE },
  },
  {
    name: '--run together with --usage',
    args: ['--run', '--usage'],
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
    name: 'a brief on stdin that reaches the model, with the default timeout',
    args: ['--run', 'flash', 'high'],
    input: 'Review "this" diff.\nSecond line.',
    expected: {
      stdout:
        'answer from gemini-3.10-flash-high in 8m: Review "this" diff.\nSecond line.',
      status: 0,
      message: '',
    },
  },
  {
    name: 'the slug of the nearest effort, run with a note and no --effort',
    args: ['--run', 'argon', 'low'],
    input: BRIEF,
    expected: {
      stdout: `answer from gemini-4-argon-medium in 8m: ${BRIEF}`,
      status: 0,
      message: 'so it runs gemini-4-argon-medium.',
    },
  },
  {
    name: 'a timeout of the command line',
    args: ['--run', '--timeout', '3', 'pro', 'high'],
    input: BRIEF,
    expected: {
      stdout: `answer from gemini-3.1-pro-high in 3m: ${BRIEF}`,
      status: 0,
      message: '',
    },
  },
  {
    name: 'an empty brief',
    args: ['--run', 'flash', 'high'],
    input: '  \n',
    runs: 0,
    expected: { stdout: '', status: 1, message: 'brief on stdin is empty' },
  },
  {
    name: 'a run that ends in the status ERROR',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_CASE: 'error' },
    expected: {
      stdout: '',
      status: 1,
      message: 'failed with status ERROR and exit code 1. quota exceeded',
    },
  },
  {
    name: 'a run that fails with an AGY_ERROR line on stderr and no error field',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_CASE: 'agent-failure' },
    expected: {
      stdout: '',
      status: 1,
      message:
        'failed with status ERROR and exit code 3. AGY_ERROR: {"code":"model_api","message":"upstream 503"}',
    },
  },
  {
    name: 'a run that exits with an AGY_ERROR line and prints no JSON',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_CASE: 'agent-failure-without-json' },
    expected: {
      stdout: '',
      status: 1,
      message:
        'exited with code 3 and printed no JSON answer. AGY_ERROR: {"code":"model_api","message":"upstream 503"}',
    },
  },
  {
    name: 'a run that ends in the status CANCELED',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_CASE: 'canceled' },
    expected: {
      stdout: '',
      status: 1,
      message: 'failed with status CANCELED and exit code 0.',
    },
  },
  {
    name: 'a run that ends in the status WAITING with an answer',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_CASE: 'waiting' },
    expected: {
      stdout: '',
      status: 1,
      message: 'failed with status WAITING and exit code 0.',
    },
  },
  {
    name: 'a run that hits the print timeout with a partial answer',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_CASE: 'timeout' },
    expected: {
      stdout: '',
      status: 1,
      message: 'stopped early with print_timeout',
    },
  },
  {
    name: 'an empty response after a denied write',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_CASE: 'denied' },
    expected: {
      stdout: '',
      status: 1,
      message: 'answered nothing. Antigravity tried write_file',
    },
  },
  {
    name: 'an answer after a denied write, noted on stderr',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_CASE: 'denied-with-answer' },
    expected: {
      stdout: 'Found two issues.',
      status: 0,
      message: 'Antigravity tried write_file, which the read-only run denies.',
    },
  },
  {
    name: 'a run that prints no JSON',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_CASE: 'noise' },
    expected: {
      stdout: '',
      status: 1,
      message: 'printed no JSON answer. panic: agy lost its connection',
    },
  },
  {
    name: 'enough usage left, with a tight group of other models ignored',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    runs: 1,
    expected: {
      stdout: `answer from gemini-3.10-flash-high in 8m: ${BRIEF}`,
      status: 0,
      message: '',
    },
  },
  {
    name: 'less than the minimum left of the weekly limit',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_USAGE: 'below' },
    runs: 0,
    expected: {
      stdout: '',
      status: 1,
      message:
        'Antigravity has 15 % left of its weekly limit for Gemini Models, below the minimum of 20 %. It resets at 2026-11-06T15:01:23Z.',
    },
  },
  {
    name: 'exactly the minimum left',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_USAGE: 'exactly' },
    runs: 1,
    expected: {
      stdout: `answer from gemini-3.10-flash-high in 8m: ${BRIEF}`,
      status: 0,
      message: '',
    },
  },
  {
    name: 'a lower minimum from the command line',
    args: ['--run', '--min-remaining', '10', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_USAGE: 'below' },
    runs: 1,
    expected: {
      stdout: `answer from gemini-3.10-flash-high in 8m: ${BRIEF}`,
      status: 0,
      message: '',
    },
  },
  {
    name: 'a higher minimum from the command line',
    args: ['--run', '--min-remaining', '95', 'flash', 'high'],
    input: BRIEF,
    runs: 0,
    expected: {
      stdout: '',
      status: 1,
      message:
        '92 % left of its weekly limit for Gemini Models, below the minimum of 95 %.',
    },
  },
  {
    name: 'a minimum of 0, which no usage falls below',
    args: ['--run', '--min-remaining', '0', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_USAGE: 'below' },
    runs: 1,
    expected: {
      stdout: `answer from gemini-3.10-flash-high in 8m: ${BRIEF}`,
      status: 0,
      message: '',
    },
  },
  {
    name: 'the minimum of the antigravity minimum line',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_USAGE: 'exactly' },
    home: homeWithRules,
    runs: 0,
    expected: {
      stdout: '',
      status: 1,
      message:
        '20 % left of its weekly limit for Gemini Models, below the minimum of 30 %.',
    },
  },
  {
    name: 'a minimum of the command line over the antigravity minimum line',
    args: ['--run', '--min-remaining', '10', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_USAGE: 'exactly' },
    home: homeWithRules,
    runs: 1,
    expected: {
      stdout: `answer from gemini-3.10-flash-high in 8m: ${BRIEF}`,
      status: 0,
      message: '',
    },
  },
  {
    name: 'a model in a group of its own, which leaves the other group alone',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_USAGE: 'argon-group' },
    runs: 1,
    expected: {
      stdout: `answer from gemini-3.10-flash-high in 8m: ${BRIEF}`,
      status: 0,
      message: '',
    },
  },
  {
    name: 'a model in a group of its own, below the minimum',
    args: ['--run', 'argon', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_USAGE: 'argon-group' },
    runs: 0,
    expected: {
      stdout: '',
      status: 1,
      message:
        '10 % left of its weekly limit for Gemini Argon, below the minimum of 20 %.',
    },
  },
  {
    name: 'a Gemini group by its name, when no description lists the model',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_USAGE: 'plain' },
    runs: 0,
    expected: {
      stdout: '',
      status: 1,
      message: '10 % left of its weekly limit for Gemini Models',
    },
  },
  {
    name: 'the tightest of several limits of a group',
    args: ['--run', 'pro', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_USAGE: 'buckets' },
    runs: 0,
    expected: {
      stdout: '',
      status: 1,
      message: '10 % left of its weekly limit for Gemini Models',
    },
  },
  {
    name: 'a /usage that fails, so the run starts with a note',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_USAGE: 'fails' },
    runs: 1,
    expected: {
      stdout: `answer from gemini-3.10-flash-high in 8m: ${BRIEF}`,
      status: 0,
      message:
        'Antigravity reports no Gemini usage, so the run starts without a usage check. `agy -p /usage` exited with code 1 and reported no groups. quota service unreachable',
    },
  },
  {
    name: 'a /usage that prints no JSON, so the run starts with a note',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_USAGE: 'garbage' },
    runs: 1,
    expected: {
      stdout: `answer from gemini-3.10-flash-high in 8m: ${BRIEF}`,
      status: 0,
      message: 'so the run starts without a usage check.',
    },
  },
  {
    name: 'a /usage without a Gemini group, so the run starts with a note',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_USAGE: 'no-gemini' },
    runs: 1,
    expected: {
      stdout: `answer from gemini-3.10-flash-high in 8m: ${BRIEF}`,
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
  {
    name: 'a run that writes a file into the work tree',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_CASE: 'writes' },
    tree: 'repo',
    expected: {
      stdout: '',
      status: 1,
      message: 'Antigravity changed files: written.txt',
    },
  },
  {
    name: 'a run that rewrites a file that was already changed',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_CASE: 'rewrites' },
    tree: 'dirty-repo',
    expected: {
      stdout: '',
      status: 1,
      message: 'Antigravity changed files: tracked.txt',
    },
  },
  {
    name: 'a run that leaves a dirty work tree as it was',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    tree: 'dirty-repo',
    expected: {
      stdout: `answer from gemini-3.10-flash-high in 8m: ${BRIEF}`,
      status: 0,
      message: '',
    },
  },
  {
    name: 'a run that writes a file outside a git work tree, which no guard sees',
    args: ['--run', 'flash', 'high'],
    input: BRIEF,
    env: { FAKE_AGY_CASE: 'writes' },
    expected: {
      stdout: `answer from gemini-3.10-flash-high in 8m: ${BRIEF}`,
      status: 0,
      message: '',
    },
  },
];

let failures = 0;

for (const [index, testCase] of CASES.entries()) {
  const { name, expected } = testCase;
  const { actual, runs } = run(testCase, index);
  const ok =
    actual.stdout === expected.stdout &&
    actual.status === expected.status &&
    (expected.message === ''
      ? actual.message === ''
      : actual.message.includes(expected.message)) &&
    (testCase.runs === undefined || testCase.runs === runs);

  if (!ok) {
    failures++;
  }

  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  if (!ok) {
    console.log(
      `  expected ${JSON.stringify(expected)}${testCase.runs === undefined ? '' : ` with ${testCase.runs} run(s) of the model`}\n  actual   ${JSON.stringify(actual)} with ${runs} run(s) of the model`,
    );
  }
}

rmSync(scratch, { recursive: true });

console.log(failures === 0 ? 'All cases pass.' : `${failures} case(s) failed.`);

process.exit(failures === 0 ? 0 : 1);

/** Creates the folder a case runs in, a git work tree for a repo and a dirty repo. */
function makeTree(kind: Tree, index: number): string {
  const folder = join(scratch, `tree-${index}`);

  mkdirSync(folder);

  if (kind === 'plain') {
    return folder;
  }

  const git = (...args: string[]) => {
    const result = spawnSync(
      'git',
      [
        '-c',
        'user.name=test',
        '-c',
        'user.email=test@example.com',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      {
        cwd: folder,
        encoding: 'utf8',
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
      },
    );

    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed. ${result.stderr}`);
    }
  };

  git('init', '-q');
  writeFileSync(join(folder, 'tracked.txt'), 'tracked\n');
  git('add', 'tracked.txt');
  git('commit', '-q', '-m', 'init');

  if (kind === 'dirty-repo') {
    appendFileSync(join(folder, 'tracked.txt'), 'edited before the run\n');
    writeFileSync(join(folder, 'notes.txt'), 'untracked\n');
  }

  return folder;
}

/** Starts the script in the folder of the case with the brief on stdin, and counts the runs of the model the stand-in CLI logged. The PATH of the environment decides which `agy` the script finds. */
function run(testCase: Case, index: number): { actual: Result; runs: number } {
  const log = join(scratch, `calls-${index}.log`);

  const result = spawnSync(process.execPath, [script, ...testCase.args], {
    cwd: makeTree(testCase.tree ?? 'plain', index),
    encoding: 'utf8',
    input: testCase.input ?? '',
    env: {
      ...process.env,
      ...withFakeAgy,
      HOME: testCase.home ?? homeWithoutRules,
      FAKE_AGY_LOG: log,
      ...testCase.env,
    },
  });

  const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n') : [];

  return {
    actual: {
      stdout: result.stdout.trim(),
      status: result.status,
      message: result.stderr,
    },
    runs: calls.filter(call => call === 'run').length,
  };
}

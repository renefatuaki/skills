#!/usr/bin/env node

// Runs the antigravity script against a stand-in Antigravity CLI and compares its output and exit code with the expected ones.

import { spawnSync } from 'node:child_process';
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

/** What the script prints on stdout, the code it exits with, and its message on stderr, which a case expects empty or containing a part. */
type Result = {
  stdout: string;
  status: number | null;
  message: string;
};

const CASES: {
  name: string;
  args: string[];
  input?: string;
  env: Record<string, string>;
  expected: Result;
}[] = [
  {
    name: 'the newest version, compared part by part',
    args: ['flash', 'high'],
    env: withFakeAgy,
    expected: { stdout: 'gemini-3.10-flash-high', status: 0, message: '' },
  },
  {
    name: 'the id of the effort asked for, over an id without an effort of the same version',
    args: ['flash', 'medium'],
    env: withFakeAgy,
    expected: { stdout: 'gemini-3.8-flash-medium', status: 0, message: '' },
  },
  {
    name: 'a version with a minor part after one without',
    args: ['pro', 'high'],
    env: withFakeAgy,
    expected: { stdout: 'gemini-3.1-pro-high', status: 0, message: '' },
  },
  {
    name: 'an id without an effort, newer than an id with one',
    args: ['argon', 'high'],
    env: withFakeAgy,
    expected: {
      stdout: 'gemini-4-argon --effort high',
      status: 0,
      message: '',
    },
  },
  {
    name: 'an id without an effort, for an effort no id ends in',
    args: ['argon', 'low'],
    env: withFakeAgy,
    expected: {
      stdout: 'gemini-4-argon --effort low',
      status: 0,
      message: '',
    },
  },
  {
    name: 'a Gemini 4 model the CLI does not list',
    args: ['carbon', 'high'],
    env: withFakeAgy,
    expected: {
      stdout: '',
      status: 1,
      message:
        'lists no model named carbon with the effort high. The account may lack the tier',
    },
  },
  {
    name: 'a name that is no Antigravity model',
    args: ['ultra', 'high'],
    env: withFakeAgy,
    expected: { stdout: '', status: 1, message: 'usage: antigravity.mts' },
  },
  {
    name: 'an effort that is no Antigravity effort',
    args: ['flash', 'max'],
    env: withFakeAgy,
    expected: { stdout: '', status: 1, message: 'usage: antigravity.mts' },
  },
  {
    name: 'a name without an effort',
    args: ['flash'],
    env: withFakeAgy,
    expected: { stdout: '', status: 1, message: 'usage: antigravity.mts' },
  },
  {
    name: 'a timeout without --run',
    args: ['--timeout', '5', 'flash', 'high'],
    env: withFakeAgy,
    expected: { stdout: '', status: 1, message: 'usage: antigravity.mts' },
  },
  {
    name: 'a timeout that is no whole number of minutes',
    args: ['--run', '--timeout', '0', 'flash', 'high'],
    input: 'Review the diff.',
    env: withFakeAgy,
    expected: { stdout: '', status: 1, message: 'usage: antigravity.mts' },
  },
  {
    name: 'an Antigravity model the CLI does not list',
    args: ['pro', 'low'],
    env: withFakeAgy,
    expected: {
      stdout: '',
      status: 1,
      message: 'lists no model named pro with the effort low',
    },
  },
  {
    name: 'no Antigravity CLI',
    args: ['flash', 'high'],
    env: { PATH: join(root, 'tests', 'fixtures', 'antigravity') },
    expected: { stdout: '', status: 1, message: 'is not installed' },
  },
  {
    name: 'a CLI that is not signed in',
    args: ['flash', 'high'],
    env: { ...withFakeAgy, FAKE_AGY_CASE: 'signed-out' },
    expected: { stdout: '', status: 1, message: 'Sign in with `agy`' },
  },
  {
    name: 'a brief on stdin that reaches the model, with the default timeout',
    args: ['--run', 'flash', 'low'],
    input: 'Review "this" diff.\nSecond line.',
    env: withFakeAgy,
    expected: {
      stdout:
        'answer from gemini-3.8-flash-low in 8m: Review "this" diff.\nSecond line.',
      status: 0,
      message: '',
    },
  },
  {
    name: 'an effort for an id that does not end in one',
    args: ['--run', 'argon', 'high'],
    input: 'Review the diff.',
    env: withFakeAgy,
    expected: {
      stdout:
        'answer from gemini-4-argon with effort high in 8m: Review the diff.',
      status: 0,
      message: '',
    },
  },
  {
    name: 'a timeout of the command line',
    args: ['--run', '--timeout', '3', 'pro', 'high'],
    input: 'Review the diff.',
    env: withFakeAgy,
    expected: {
      stdout: 'answer from gemini-3.1-pro-high in 3m: Review the diff.',
      status: 0,
      message: '',
    },
  },
  {
    name: 'an empty brief',
    args: ['--run', 'flash', 'low'],
    input: '  \n',
    env: withFakeAgy,
    expected: { stdout: '', status: 1, message: 'brief on stdin is empty' },
  },
  {
    name: 'a run that ends in the status ERROR',
    args: ['--run', 'flash', 'low'],
    input: 'Review the diff.',
    env: { ...withFakeAgy, FAKE_AGY_CASE: 'error' },
    expected: {
      stdout: '',
      status: 1,
      message: 'failed with status ERROR and exit code 1. quota exceeded',
    },
  },
  {
    name: 'a run that hits the print timeout with a partial answer',
    args: ['--run', 'flash', 'low'],
    input: 'Review the diff.',
    env: { ...withFakeAgy, FAKE_AGY_CASE: 'timeout' },
    expected: {
      stdout: '',
      status: 1,
      message: 'stopped early with print_timeout',
    },
  },
  {
    name: 'an empty response after a denied write',
    args: ['--run', 'flash', 'low'],
    input: 'Review the diff.',
    env: { ...withFakeAgy, FAKE_AGY_CASE: 'denied' },
    expected: {
      stdout: '',
      status: 1,
      message: 'answered nothing. Antigravity tried write_file',
    },
  },
  {
    name: 'an answer after a denied write, noted on stderr',
    args: ['--run', 'flash', 'low'],
    input: 'Review the diff.',
    env: { ...withFakeAgy, FAKE_AGY_CASE: 'denied-with-answer' },
    expected: {
      stdout: 'Found two issues.',
      status: 0,
      message: 'Antigravity tried write_file, which the read-only run denies.',
    },
  },
  {
    name: 'a run that prints no JSON',
    args: ['--run', 'flash', 'low'],
    input: 'Review the diff.',
    env: { ...withFakeAgy, FAKE_AGY_CASE: 'noise' },
    expected: {
      stdout: '',
      status: 1,
      message: 'printed no JSON answer. panic: agy lost its connection',
    },
  },
];

let failures = 0;

for (const { name, args, input, env, expected } of CASES) {
  const actual = run(args, input, env);
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

/** Starts the script with the brief on stdin and the environment of the case, whose PATH decides which `agy` it finds. */
function run(
  args: string[],
  input: string | undefined,
  env: Record<string, string>,
): Result {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    input: input ?? '',
    env: { ...process.env, ...env },
  });

  return {
    stdout: result.stdout.trim(),
    status: result.status,
    message: result.stderr,
  };
}

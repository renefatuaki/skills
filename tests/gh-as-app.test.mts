#!/usr/bin/env node

// Runs the gh-as-app script against a stand-in for gh and checks that it passes the arguments, the standard streams and the exit code through, runs plain gh without an app and refuses a configuration whose key is missing.

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(
  root,
  'plugins',
  'forge',
  'skills',
  'github',
  'pull-request',
  'scripts',
  'gh-as-app.mts',
);

const workspace = mkdtempSync(join(tmpdir(), 'forge-gh-as-app-'));
const bin = join(workspace, 'bin');
const emptyHome = join(workspace, 'empty');
const brokenHome = join(workspace, 'broken');

mkdirSync(bin);
mkdirSync(emptyHome);
mkdirSync(join(brokenHome, 'forge'), { recursive: true });

writeFileSync(
  join(bin, 'gh'),
  [
    '#!/bin/sh',
    'echo "args:$*"',
    'echo "token:${GH_TOKEN-unset}"',
    'echo "stdin:$(cat)"',
    'echo "oops" >&2',
    'exit "${FAKE_GH_EXIT:-0}"',
  ].join('\n'),
);

chmodSync(join(bin, 'gh'), 0o755);

writeFileSync(
  join(brokenHome, 'forge', 'github-app.json'),
  JSON.stringify({ clientId: 'Iv1.test', privateKey: 'missing.pem' }),
);

let failures = 0;

const plain = run(['pr', 'create', '--body-file', '-'], emptyHome, {
  input: 'the body',
  env: { GH_TOKEN: undefined },
});

failures += report('without an app gh gets the arguments', plain.stdout, [
  'args:pr create --body-file -',
  'token:unset',
  'stdin:the body',
]);

failures += report('stderr passes through', plain.stderr, ['oops']);

failures += report(
  'without an app the token of the caller stays',
  run(['pr', 'view'], emptyHome, { env: { GH_TOKEN: 'user-token' } }).stdout[1],
  'token:user-token',
);

failures += report(
  'the repository option stays in the arguments gh gets',
  run(['pr', 'view', '--repo', 'owner/name', '12'], emptyHome).stdout[0],
  'args:pr view --repo owner/name 12',
);

failures += report(
  'the exit code of gh passes through',
  run(['pr', 'view'], emptyHome, { env: { FAKE_GH_EXIT: '3' } }).status,
  3,
);

const broken = run(['pr', 'view'], brokenHome);

failures += report(
  'a missing private key stops with status 1',
  broken.status,
  1,
);

failures += report('a missing private key does not reach gh', broken.stdout, [
  '',
]);

failures += report(
  'a missing private key names the file',
  broken.stderr[0].includes('missing.pem'),
  true,
);

rmSync(workspace, { recursive: true });

console.log(failures === 0 ? 'All cases pass.' : `${failures} case(s) failed.`);

process.exit(failures === 0 ? 0 : 1);

/** Runs the script with the stand-in gh first on the path and splits its output into lines. */
function run(
  args: string[],
  xdgConfigHome: string,
  options: {
    input?: string;
    env?: Record<string, string | undefined>;
  } = {},
): { status: number | null; stdout: string[]; stderr: string[] } {
  const result = spawnSync('node', [script, ...args], {
    input: options.input ?? '',
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      XDG_CONFIG_HOME: xdgConfigHome,
      ...options.env,
    },
  });

  return {
    status: result.status,
    stdout: result.stdout.trimEnd().split('\n'),
    stderr: result.stderr.trimEnd().split('\n'),
  };
}

function report(name: string, actual: unknown, expected: unknown): number {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);

  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  if (!ok) {
    console.log(
      `  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`,
    );
  }

  return ok ? 0 : 1;
}

// Runs the companion and the hooks against the fake `agy` of fixtures/bin in throwaway git repositories.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);

export const COMPANION = join(
  PLUGIN_ROOT,
  'scripts',
  'antigravity-companion.mts',
);

export const SESSION_HOOK = join(
  PLUGIN_ROOT,
  'scripts',
  'session-lifecycle-hook.mts',
);

export const STOP_HOOK = join(
  PLUGIN_ROOT,
  'scripts',
  'stop-review-gate-hook.mts',
);

export const REVIEW_SCHEMA = join(
  PLUGIN_ROOT,
  'schemas',
  'review-output.schema.json',
);

const FAKE_AGY_DIR = join(PLUGIN_ROOT, 'tests', 'fixtures', 'bin');

/** What a command printed and the code it ended with. */
export type Output = {
  stdout: string;
  stderr: string;
  status: number | null;
};

/** One call of the fake `agy`, with the arguments it got and the folder it ran in. */
export type AgyCall = { args: string[]; cwd: string };

/** A throwaway environment, with its own plugin data folder, call log and repository. */
export type Sandbox = {
  root: string;
  repo: string;
  log: string;
  env: Record<string, string>;
};

const createdRoots: string[] = [];

process.on('exit', () => {
  for (const root of createdRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Creates a git repository with one commit, and with an edit and an untracked file when it is dirty. */
export function makeSandbox(dirty = false): Sandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'antigravity-test-')));
  const repo = join(root, 'repo');

  createdRoots.push(root);

  mkdirSync(repo);

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
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
      },
    );

    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed. ${result.stderr}`);
    }
  };

  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'tracked.txt'), 'tracked\n');
  git('add', 'tracked.txt');
  git('commit', '-q', '-m', 'init');

  if (dirty) {
    writeFileSync(join(repo, 'tracked.txt'), 'tracked\nedited\n');
    writeFileSync(join(repo, 'notes.txt'), 'untracked\n');
  }

  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ANTIGRAVITY_COMPANION_SESSION_ID') {
      env[key] = value;
    }
  }

  const log = join(root, 'agy-calls.jsonl');

  return {
    root,
    repo,
    log,
    env: {
      ...env,
      PATH: `${FAKE_AGY_DIR}${delimiter}${process.env.PATH}`,
      CLAUDE_PLUGIN_DATA: join(root, 'antigravity-inline'),
      FAKE_AGY_LOG: log,
    },
  };
}

/** Runs a script of the plugin and returns what it printed. */
export function runScript(
  script: string,
  args: string[],
  sandbox: Sandbox,
  options: { env?: Record<string, string>; input?: string; cwd?: string } = {},
): Output {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd ?? sandbox.repo,
    encoding: 'utf8',
    input: options.input ?? '',
    env: { ...sandbox.env, ...options.env },
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
  };
}

export function runCompanion(
  args: string[],
  sandbox: Sandbox,
  options: { env?: Record<string, string>; input?: string; cwd?: string } = {},
): Output {
  return runScript(COMPANION, args, sandbox, options);
}

/** Reads the calls the fake `agy` logged. */
export function readCalls(sandbox: Sandbox): AgyCall[] {
  if (!existsSync(sandbox.log)) {
    return [];
  }

  return readFileSync(sandbox.log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

/** The calls that ran a prompt, not the version check, the model list or /usage. */
export function readRuns(sandbox: Sandbox): AgyCall[] {
  return readCalls(sandbox).filter(
    call => call.args[0] === '-p' && call.args[1] !== '/usage',
  );
}

/** Returns the value that follows a flag, or undefined when the call lacks it. */
export function flagValue(call: AgyCall, flag: string): string | undefined {
  const index = call.args.indexOf(flag);

  return index === -1 ? undefined : call.args[index + 1];
}

/** Waits until the check holds, and fails after the timeout. */
export async function waitFor(
  check: () => boolean,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out while waiting for a condition.');
    }

    await new Promise(done => setTimeout(done, 100));
  }
}

/** Tells whether a process is still alive. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

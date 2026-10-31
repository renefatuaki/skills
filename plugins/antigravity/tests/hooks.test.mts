#!/usr/bin/env node

// Drives the session lifecycle hook and the stop review gate the way Claude Code does, with JSON on stdin, against the fake `agy`.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  isAlive,
  makeSandbox,
  readRuns,
  runCompanion,
  runScript,
  SESSION_HOOK,
  STOP_HOOK,
  waitFor,
} from './harness.mts';

describe('session lifecycle hook', () => {
  it('appends the session id and the plugin data folder to the env file on SessionStart', () => {
    const sandbox = makeSandbox();
    const envFile = join(sandbox.root, 'env.sh');

    writeFileSync(envFile, '');

    const result = runScript(SESSION_HOOK, ['SessionStart'], sandbox, {
      env: { CLAUDE_ENV_FILE: envFile },
      input: JSON.stringify({
        session_id: "it's-1",
        hook_event_name: 'SessionStart',
      }),
    });

    assert.equal(result.status, 0, result.stderr);

    const env = readFileSync(envFile, 'utf8');

    assert.match(
      env,
      /^export ANTIGRAVITY_COMPANION_SESSION_ID='it'"'"'s-1'$/m,
    );

    assert.match(
      env,
      new RegExp(
        `^export ANTIGRAVITY_COMPANION_DATA='${sandbox.env.CLAUDE_PLUGIN_DATA}'$`,
        'm',
      ),
    );
  });

  it('stops the running jobs of the session and forgets its jobs on SessionEnd', async () => {
    const sandbox = makeSandbox();
    const pidFile = join(sandbox.root, 'pids');
    const env = {
      ANTIGRAVITY_COMPANION_SESSION_ID: 'session-1',
      FAKE_AGY_CASE: 'sleep',
      FAKE_AGY_PIDFILE: pidFile,
    };

    runCompanion(['task', 'finished one'], sandbox, {
      env: { ANTIGRAVITY_COMPANION_SESSION_ID: 'session-1' },
    });

    runCompanion(['task', 'other session'], sandbox, {
      env: { ANTIGRAVITY_COMPANION_SESSION_ID: 'session-2' },
    });

    runCompanion(['task', '--background', 'hang'], sandbox, { env });

    await waitFor(
      () =>
        existsSync(pidFile) &&
        readFileSync(pidFile, 'utf8').trim().includes(' '),
    );

    const [agyPid, toolPid] = readFileSync(pidFile, 'utf8')
      .trim()
      .split(' ')
      .map(Number);

    const result = runScript(SESSION_HOOK, ['SessionEnd'], sandbox, {
      input: JSON.stringify({
        session_id: 'session-1',
        cwd: sandbox.repo,
        hook_event_name: 'SessionEnd',
      }),
    });

    assert.equal(result.status, 0, result.stderr);

    await waitFor(() => !isAlive(agyPid) && !isAlive(toolPid));

    const jobs = JSON.parse(
      runCompanion(['status', '--all', '--json'], sandbox, {
        env: { ANTIGRAVITY_COMPANION_SESSION_ID: 'session-2' },
      }).stdout,
    );

    assert.equal(jobs.latestFinished.summary, 'answer: other session');

    const first = JSON.parse(
      runCompanion(['status', '--all', '--json'], sandbox, {
        env: { ANTIGRAVITY_COMPANION_SESSION_ID: 'session-1' },
      }).stdout,
    );

    assert.equal(first.latestFinished, null);
    assert.equal(first.running.length, 0);
  });
});

describe('stop review gate', () => {
  const stop = (
    sandbox: ReturnType<typeof makeSandbox>,
    env: Record<string, string> = {},
  ) =>
    runScript(STOP_HOOK, [], sandbox, {
      env,
      input: JSON.stringify({
        session_id: 'session-1',
        cwd: sandbox.repo,
        last_assistant_message: 'I edited tracked.txt.',
      }),
    });

  it('does nothing while the gate is off', () => {
    const sandbox = makeSandbox(true);
    const result = stop(sandbox);

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(readRuns(sandbox).length, 0);
  });

  it('allows the stop when the review answers ALLOW', () => {
    const sandbox = makeSandbox(true);

    runCompanion(['setup', '--enable-review-gate'], sandbox);

    const result = stop(sandbox, { FAKE_AGY_CASE: 'allow' });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');

    const [call] = readRuns(sandbox).slice(-1);

    assert.ok(!call.args.includes('--mode'));
    assert.match(
      call.args[1],
      /Run a stop-gate review of the previous Claude turn\./,
    );

    assert.match(
      call.args[1],
      /Previous Claude response:\nI edited tracked\.txt\./,
    );

    assert.match(call.args[1], /Repository state right now:/);
    assert.match(call.args[1], /\+edited/);
  });

  it('blocks the stop when the review answers BLOCK', () => {
    const sandbox = makeSandbox(true);

    runCompanion(['setup', '--enable-review-gate'], sandbox);

    const result = stop(sandbox, { FAKE_AGY_CASE: 'block' });
    const decision = JSON.parse(result.stdout);

    assert.equal(decision.decision, 'block');
    assert.match(
      decision.reason,
      /found issues that still need fixes before ending the session: the new branch has no test/,
    );
  });

  it('blocks the stop with the failure when the review run fails', () => {
    const sandbox = makeSandbox(true);

    runCompanion(['setup', '--enable-review-gate'], sandbox);

    const decision = JSON.parse(
      stop(sandbox, { FAKE_AGY_CASE: 'error' }).stdout,
    );

    assert.equal(decision.decision, 'block');
    assert.match(
      decision.reason,
      /stop-time Antigravity review task failed: .*quota exceeded/s,
    );
  });

  it('blocks the stop on an answer that is neither ALLOW nor BLOCK', () => {
    const sandbox = makeSandbox(true);

    runCompanion(['setup', '--enable-review-gate'], sandbox);

    const decision = JSON.parse(stop(sandbox).stdout);

    assert.match(decision.reason, /unexpected answer/);
  });

  it('only notes the setup problem when agy is missing', () => {
    const sandbox = makeSandbox(true);

    runCompanion(['setup', '--enable-review-gate'], sandbox);

    const result = stop(sandbox, { PATH: '/usr/bin:/bin' });

    assert.equal(result.stdout, '');
    assert.match(
      result.stderr,
      /Antigravity is not set up for the review gate\./,
    );
  });

  it('notes a task that still runs', async () => {
    const sandbox = makeSandbox(true);
    const pidFile = join(sandbox.root, 'pids');

    runCompanion(['task', '--background', 'hang'], sandbox, {
      env: {
        ANTIGRAVITY_COMPANION_SESSION_ID: 'session-1',
        FAKE_AGY_CASE: 'sleep',
        FAKE_AGY_PIDFILE: pidFile,
      },
    });

    await waitFor(() => existsSync(pidFile));

    const result = stop(sandbox);

    assert.match(
      result.stderr,
      /Antigravity task task-\S+ is still running\. Check \/antigravity:status/,
    );

    runCompanion(['cancel'], sandbox, {
      env: { ANTIGRAVITY_COMPANION_SESSION_ID: 'session-1' },
    });
  });
});

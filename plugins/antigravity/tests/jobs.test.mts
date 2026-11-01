#!/usr/bin/env node

// Runs background tasks, status, result and cancel against the fake `agy`, and compares the job records with the Codex companion semantics.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  flagValue,
  isAlive,
  makeSandbox,
  readRuns,
  runCompanion,
  waitFor,
} from './harness.mts';
import type { Sandbox } from './harness.mts';

const SESSION = { ANTIGRAVITY_COMPANION_SESSION_ID: 'session-1' };

/** Starts a background task and returns its job id. */
function startBackground(
  sandbox: Sandbox,
  args: string[],
  env: Record<string, string> = {},
): string {
  const result = runCompanion(
    ['task', '--background', '--json', ...args],
    sandbox,
    {
      env: { ...SESSION, ...env },
    },
  );

  assert.equal(result.status, 0, result.stdout + result.stderr);

  return JSON.parse(result.stdout).jobId;
}

describe('background task', () => {
  it('queues a worker, finishes it and serves status and result', () => {
    const sandbox = makeSandbox();

    const queued = runCompanion(
      ['task', '--background', 'in the background'],
      sandbox,
      {
        env: SESSION,
      },
    );

    assert.equal(queued.status, 0);

    const jobId = /started in the background as (task-\S+)\./.exec(
      queued.stdout,
    )?.[1];

    assert.ok(jobId, queued.stdout);
    assert.match(
      queued.stdout,
      new RegExp(`Check /antigravity:status ${jobId} for progress`),
    );

    const waited = runCompanion(
      ['status', jobId, '--wait', '--timeout-ms', '20000', '--json'],
      sandbox,
      { env: SESSION },
    );

    const snapshot = JSON.parse(waited.stdout);

    assert.equal(snapshot.job.status, 'completed', waited.stdout);
    assert.equal(snapshot.waitTimedOut, false);
    assert.equal(snapshot.job.conversationId, 'conv-new');

    const [call] = readRuns(sandbox);

    assert.ok(!call.args.includes('--print-timeout'));
    assert.ok(!call.args.includes('--mode'));

    const result = runCompanion(['result', jobId], sandbox, { env: SESSION });

    assert.match(result.stdout, /^answer: in the background\n/);
    assert.match(
      result.stdout,
      /Antigravity conversation ID: conv-new\nResume in Antigravity: agy --conversation conv-new/,
    );

    const status = runCompanion(['status'], sandbox, { env: SESSION });

    assert.match(status.stdout, /^# Antigravity Status/);
    assert.match(
      status.stdout,
      new RegExp(
        `Latest finished:\\n- ${jobId} \\| completed \\| rescue \\| Antigravity Task`,
      ),
    );
  });

  it('passes the print timeout of --timeout to a background run', async () => {
    const sandbox = makeSandbox();
    const jobId = startBackground(sandbox, ['--timeout', '5', 'timed']);

    runCompanion(
      ['status', jobId, '--wait', '--timeout-ms', '20000'],
      sandbox,
      { env: SESSION },
    );

    assert.equal(flagValue(readRuns(sandbox)[0], '--print-timeout'), '5m');
  });

  it('runs a background write task with the write flags', () => {
    const sandbox = makeSandbox();
    const jobId = startBackground(sandbox, ['--write', 'edit']);

    runCompanion(
      ['status', jobId, '--wait', '--timeout-ms', '20000'],
      sandbox,
      { env: SESSION },
    );

    const [call] = readRuns(sandbox);

    assert.equal(flagValue(call, '--mode'), 'accept-edits');
    assert.ok(call.args.includes('--sandbox'));

    const status = runCompanion(['status', jobId], sandbox, { env: SESSION });

    assert.match(status.stdout, /Review changes: \/antigravity:review --wait/);
  });

  it('records a failed background run', () => {
    const sandbox = makeSandbox();
    const jobId = startBackground(sandbox, ['go'], { FAKE_AGY_CASE: 'error' });

    const waited = runCompanion(
      ['status', jobId, '--wait', '--timeout-ms', '20000', '--json'],
      sandbox,
      { env: SESSION },
    );

    assert.equal(JSON.parse(waited.stdout).job.status, 'failed');

    const result = runCompanion(['result', jobId], sandbox, { env: SESSION });

    assert.match(result.stdout, /Error: quota exceeded/);
  });

  it('refuses the result of a job that still runs', async () => {
    const sandbox = makeSandbox();
    const pidFile = join(sandbox.root, 'pids');
    const jobId = startBackground(sandbox, ['go'], {
      FAKE_AGY_CASE: 'sleep',
      FAKE_AGY_PIDFILE: pidFile,
    });

    await waitFor(() => existsSync(pidFile));

    const result = runCompanion(['result', jobId], sandbox, { env: SESSION });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /is still (queued|running)/);

    runCompanion(['cancel', jobId], sandbox, { env: SESSION });
  });
});

describe('cancel', () => {
  it('stops the worker and the process group of agy and marks the job cancelled', async () => {
    const sandbox = makeSandbox();
    const pidFile = join(sandbox.root, 'pids');
    const jobId = startBackground(sandbox, ['hang'], {
      FAKE_AGY_CASE: 'sleep',
      FAKE_AGY_PIDFILE: pidFile,
    });

    await waitFor(
      () =>
        existsSync(pidFile) &&
        readFileSync(pidFile, 'utf8').trim().includes(' '),
    );

    const [agyPid, toolPid] = readFileSync(pidFile, 'utf8')
      .trim()
      .split(' ')
      .map(Number);

    assert.ok(isAlive(agyPid));
    assert.ok(isAlive(toolPid));

    const running = JSON.parse(
      runCompanion(['status', jobId, '--json'], sandbox, { env: SESSION })
        .stdout,
    );

    assert.equal(running.job.status, 'running');
    assert.equal(running.job.agyPid, agyPid);

    const cancelled = runCompanion(['cancel', jobId, '--json'], sandbox, {
      env: SESSION,
    });

    assert.equal(cancelled.status, 0, cancelled.stderr);

    const payload = JSON.parse(cancelled.stdout);

    assert.equal(payload.status, 'cancelled');
    assert.equal(payload.agyTerminated, true);

    await waitFor(() => !isAlive(agyPid) && !isAlive(toolPid));

    const after = JSON.parse(
      runCompanion(['status', jobId, '--json'], sandbox, { env: SESSION })
        .stdout,
    );

    assert.equal(after.job.status, 'cancelled');
    assert.equal(after.job.phase, 'cancelled');

    const result = runCompanion(['result', jobId], sandbox, { env: SESSION });

    assert.match(result.stdout, /Status: cancelled/);
    assert.match(result.stdout, /Cancelled by user\./);
  });

  it('cancels the only active job of the session without a job id', async () => {
    const sandbox = makeSandbox();
    const pidFile = join(sandbox.root, 'pids');

    startBackground(sandbox, ['hang'], {
      FAKE_AGY_CASE: 'sleep',
      FAKE_AGY_PIDFILE: pidFile,
    });

    await waitFor(() => existsSync(pidFile));

    const cancelled = runCompanion(['cancel'], sandbox, { env: SESSION });

    assert.match(cancelled.stdout, /^# Antigravity Cancel\n\nCancelled task-/);

    const none = runCompanion(['cancel'], sandbox, { env: SESSION });

    assert.equal(none.status, 1);
    assert.match(
      none.stderr,
      /No active Antigravity jobs to cancel for this session\./,
    );
  });

  it('fails for an unknown job', () => {
    const sandbox = makeSandbox();
    const result = runCompanion(['cancel', 'task-nope'], sandbox);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /No active job found|No job found/);
  });
});

describe('status', () => {
  it('reports an empty history', () => {
    const sandbox = makeSandbox();
    const result = runCompanion(['status'], sandbox);

    assert.match(result.stdout, /No jobs recorded yet\./);
  });

  it('lists the recent jobs and requires a job id for --wait', () => {
    const sandbox = makeSandbox();

    runCompanion(['task', 'one'], sandbox);
    runCompanion(['task', 'two'], sandbox);

    const status = runCompanion(['status', '--all'], sandbox);

    assert.match(status.stdout, /Latest finished:/);
    assert.match(status.stdout, /Recent jobs:/);

    const wait = runCompanion(['status', '--wait'], sandbox);

    assert.equal(wait.status, 1);
    assert.match(wait.stderr, /requires a job id/);
  });
});

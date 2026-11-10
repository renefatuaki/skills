#!/usr/bin/env node

// Ported from scripts/session-lifecycle-hook.mjs of the OpenAI Codex plugin for Claude Code 1.0.6 (Apache-2.0 License, Copyright 2026 OpenAI).
// The broker teardown and the transcript path are dropped because there is no shared runtime and no session transfer.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import { terminateProcessTree } from './lib/process.mts';
import {
  COMPANION_DATA_ENV,
  loadState,
  resolveStateFile,
  saveState,
} from './lib/state.mts';
import { SESSION_ID_ENV } from './lib/tracked-jobs.mts';
import { resolveWorkspaceRoot } from './lib/workspace.mts';

const PLUGIN_DATA_ENV = 'CLAUDE_PLUGIN_DATA';

/** The fields of the hook input that this script reads. */
type HookInput = {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
};

function readHookInput(): HookInput {
  const raw = readFileSync(0, 'utf8').trim();

  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Appends an export line to the env file Claude Code sources before each Bash call. */
function appendEnvVar(name: string, value: string | undefined): void {
  const envFile = process.env.CLAUDE_ENV_FILE;

  if (!envFile || value == null || value === '') {
    return;
  }

  appendFileSync(envFile, `export ${name}=${shellEscape(value)}\n`, 'utf8');
}

/** Stops the jobs of the session that still run, and removes all of its jobs from the state. */
function cleanupSessionJobs(cwd: string, sessionId: string | undefined): void {
  if (!cwd || !sessionId) {
    return;
  }

  const workspaceRoot = resolveWorkspaceRoot(cwd);

  if (!existsSync(resolveStateFile(workspaceRoot))) {
    return;
  }

  const state = loadState(workspaceRoot);
  const removedJobs = state.jobs.filter(job => job.sessionId === sessionId);

  if (removedJobs.length === 0) {
    return;
  }

  for (const job of removedJobs) {
    if (job.status !== 'queued' && job.status !== 'running') {
      continue;
    }

    for (const pid of [job.pid, job.agyPid]) {
      try {
        terminateProcessTree(pid ?? Number.NaN);
      } catch {
        // Ignore teardown failures during session shutdown.
      }
    }
  }

  saveState(workspaceRoot, {
    ...state,
    jobs: state.jobs.filter(job => job.sessionId !== sessionId),
  });
}

function handleSessionStart(input: HookInput): void {
  appendEnvVar(SESSION_ID_ENV, input.session_id);
  appendEnvVar(COMPANION_DATA_ENV, process.env[PLUGIN_DATA_ENV]);
}

function handleSessionEnd(input: HookInput): void {
  cleanupSessionJobs(
    input.cwd || process.cwd(),
    input.session_id || process.env[SESSION_ID_ENV],
  );
}

function main(): void {
  const input = readHookInput();
  const eventName = process.argv[2] ?? input.hook_event_name ?? '';

  if (eventName === 'SessionStart') {
    handleSessionStart(input);

    return;
  }

  if (eventName === 'SessionEnd') {
    handleSessionEnd(input);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );

  process.exit(1);
}

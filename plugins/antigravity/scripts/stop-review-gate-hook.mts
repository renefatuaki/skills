#!/usr/bin/env node

// Ported from scripts/stop-review-gate-hook.mjs of the OpenAI Codex plugin for Claude Code 1.0.6 (Apache-2.0 License, Copyright 2026 OpenAI).
// A read-only Antigravity run cannot run shell commands, so the hook hands it a snapshot of the work tree in the prompt.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getAgyAvailability } from './lib/agy.mts';
import { sortJobsNewestFirst } from './lib/job-control.mts';
import { runCommand } from './lib/process.mts';
import { interpolateTemplate, loadPromptTemplate } from './lib/prompts.mts';
import { getConfig, listJobs } from './lib/state.mts';
import { SESSION_ID_ENV } from './lib/tracked-jobs.mts';
import type { Job } from './lib/types.mts';
import { resolveWorkspaceRoot } from './lib/workspace.mts';

const STOP_REVIEW_TIMEOUT_MS = 15 * 60 * 1000;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(SCRIPT_DIR, '..');
const MAX_SNAPSHOT_DIFF_BYTES = 30 * 1024;

/** The fields of the hook input that this script reads. */
type HookInput = {
  session_id?: string;
  cwd?: string;
  last_assistant_message?: string;
};

type ReviewVerdict = { ok: boolean; reason: string | null };

function readHookInput(): HookInput {
  const raw = readFileSync(0, 'utf8').trim();

  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function emitDecision(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function logNote(message: string | null): void {
  if (message) {
    process.stderr.write(`${message}\n`);
  }
}

function filterJobsForCurrentSession(jobs: Job[], input: HookInput): Job[] {
  const sessionId = input.session_id || process.env[SESSION_ID_ENV] || null;

  if (!sessionId) {
    return jobs;
  }

  return jobs.filter(job => job.sessionId === sessionId);
}

/** Describes the work tree in text, the status, the diffstat and the start of the diff. */
function buildWorktreeSnapshot(cwd: string): string {
  const git = (args: string[]) =>
    runCommand('git', args, { cwd, shell: false, maxBuffer: 16 * 1024 * 1024 });

  const status = git(['status', '--short', '--untracked-files=all']);

  if (status.error !== null || status.status !== 0) {
    return 'The folder is not a Git work tree, so no repository state is available.';
  }

  const stat = git(['diff', 'HEAD', '--stat']).stdout.trim();
  const diff = git(['diff', 'HEAD', '--no-ext-diff']).stdout;

  const clipped =
    Buffer.byteLength(diff, 'utf8') > MAX_SNAPSHOT_DIFF_BYTES
      ? `${diff.slice(0, MAX_SNAPSHOT_DIFF_BYTES)}\n(diff cut at ${MAX_SNAPSHOT_DIFF_BYTES} bytes)`
      : diff;

  return [
    'Repository state right now:',
    '',
    'Git status:',
    status.stdout.trim() || '(clean)',
    '',
    'Diff stat against HEAD:',
    stat || '(none)',
    '',
    'Diff against HEAD:',
    clipped.trim() || '(none)',
  ].join('\n');
}

function buildStopReviewPrompt(cwd: string, input: HookInput): string {
  const lastAssistantMessage = String(
    input.last_assistant_message ?? '',
  ).trim();

  const template = loadPromptTemplate(ROOT_DIR, 'stop-review-gate');

  const claudeResponseBlock = lastAssistantMessage
    ? ['Previous Claude response:', lastAssistantMessage].join('\n')
    : '';

  return interpolateTemplate(template, {
    CLAUDE_RESPONSE_BLOCK: claudeResponseBlock,
    WORKTREE_SNAPSHOT: buildWorktreeSnapshot(cwd),
  });
}

function buildSetupNote(cwd: string): string | null {
  const availability = getAgyAvailability(cwd);

  if (availability.available) {
    return null;
  }

  const detail = availability.detail ? ` ${availability.detail}.` : '';

  return `Antigravity is not set up for the review gate.${detail} Run /antigravity:setup.`;
}

function parseStopReviewOutput(rawOutput: unknown): ReviewVerdict {
  const text = String(rawOutput ?? '').trim();

  if (!text) {
    return {
      ok: false,
      reason:
        'The stop-time Antigravity review task returned no final output. Run /antigravity:review --wait manually or bypass the gate.',
    };
  }

  const firstLine = text.split(/\r?\n/, 1)[0].trim();

  if (firstLine.startsWith('ALLOW:')) {
    return { ok: true, reason: null };
  }

  if (firstLine.startsWith('BLOCK:')) {
    const reason = firstLine.slice('BLOCK:'.length).trim() || text;

    return {
      ok: false,
      reason: `Antigravity stop-time review found issues that still need fixes before ending the session: ${reason}`,
    };
  }

  return {
    ok: false,
    reason:
      'The stop-time Antigravity review task returned an unexpected answer. Run /antigravity:review --wait manually or bypass the gate.',
  };
}

function runStopReview(cwd: string, input: HookInput): ReviewVerdict {
  const scriptPath = resolve(SCRIPT_DIR, 'antigravity-companion.mts');
  const prompt = buildStopReviewPrompt(cwd, input);

  const childEnv = {
    ...process.env,
    ...(input.session_id ? { [SESSION_ID_ENV]: input.session_id } : {}),
  };

  const result = spawnSync(
    process.execPath,
    [scriptPath, 'task', '--json', prompt],
    {
      cwd,
      env: childEnv,
      encoding: 'utf8',
      timeout: STOP_REVIEW_TIMEOUT_MS,
    },
  );

  if (
    (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT'
  ) {
    return {
      ok: false,
      reason:
        'The stop-time Antigravity review task timed out after 15 minutes. Run /antigravity:review --wait manually or bypass the gate.',
    };
  }

  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();

    return {
      ok: false,
      reason: detail
        ? `The stop-time Antigravity review task failed: ${detail}`
        : 'The stop-time Antigravity review task failed. Run /antigravity:review --wait manually or bypass the gate.',
    };
  }

  try {
    const payload = JSON.parse(result.stdout);

    return parseStopReviewOutput(payload?.rawOutput);
  } catch {
    return {
      ok: false,
      reason:
        'The stop-time Antigravity review task returned invalid JSON. Run /antigravity:review --wait manually or bypass the gate.',
    };
  }
}

function main(): void {
  const input = readHookInput();
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const config = getConfig(workspaceRoot);

  const jobs = sortJobsNewestFirst(
    filterJobsForCurrentSession(listJobs(workspaceRoot), input),
  );

  const runningJob = jobs.find(
    job => job.status === 'queued' || job.status === 'running',
  );

  const runningTaskNote = runningJob
    ? `Antigravity task ${runningJob.id} is still running. Check /antigravity:status and use /antigravity:cancel ${runningJob.id} if you want to stop it before ending the session.`
    : null;

  if (!config.stopReviewGate) {
    logNote(runningTaskNote);

    return;
  }

  const setupNote = buildSetupNote(cwd);

  if (setupNote) {
    logNote(setupNote);
    logNote(runningTaskNote);

    return;
  }

  const review = runStopReview(cwd, input);

  if (!review.ok) {
    emitDecision({
      decision: 'block',
      reason: runningTaskNote
        ? `${runningTaskNote} ${review.reason}`
        : review.reason,
    });

    return;
  }

  logNote(runningTaskNote);
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );

  process.exitCode = 1;
}

// Ported from scripts/lib/job-control.mjs of the OpenAI Codex plugin for Claude Code 1.0.6 (Apache-2.0 License, Copyright 2026 OpenAI).

import { existsSync, readFileSync } from 'node:fs';

import { getConfig, listJobs, readJobFile, resolveJobFile } from './state.mts';
import { SESSION_ID_ENV } from './tracked-jobs.mts';
import type { EnrichedJob, Job, State, StoredJob } from './types.mts';
import { resolveWorkspaceRoot } from './workspace.mts';

export const DEFAULT_MAX_STATUS_JOBS = 8;
export const DEFAULT_MAX_PROGRESS_LINES = 4;

/** The job references and the session a lookup runs in. */
type LookupOptions = { env?: NodeJS.ProcessEnv };

/** What `status` reports for a workspace. */
export type StatusSnapshot = {
  workspaceRoot: string;
  config: State['config'];
  running: EnrichedJob[];
  latestFinished: EnrichedJob | null;
  recent: EnrichedJob[];
  needsReview: boolean;
};

export function isActiveJob(job: Job): boolean {
  return job.status === 'queued' || job.status === 'running';
}

export function sortJobsNewestFirst(jobs: Job[]): Job[] {
  return [...jobs].sort((left, right) =>
    String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')),
  );
}

export function getCurrentSessionId(
  options: LookupOptions = {},
): string | null {
  return options.env?.[SESSION_ID_ENV] ?? process.env[SESSION_ID_ENV] ?? null;
}

/** Keeps the jobs of the current Claude session, or all jobs when the session is unknown. */
export function filterJobsForCurrentSession(
  jobs: Job[],
  options: LookupOptions = {},
): Job[] {
  const sessionId = getCurrentSessionId(options);

  if (!sessionId) {
    return jobs;
  }

  return jobs.filter(job => job.sessionId === sessionId);
}

function getJobTypeLabel(job: Job): string {
  if (typeof job.kindLabel === 'string' && job.kindLabel) {
    return job.kindLabel;
  }

  if (job.kind === 'adversarial-review') {
    return 'adversarial-review';
  }

  if (job.jobClass === 'review' || job.kind === 'review') {
    return 'review';
  }

  if (job.jobClass === 'task' || job.kind === 'task') {
    return 'rescue';
  }

  return 'job';
}

function stripLogPrefix(line: string): string {
  return line.replace(/^\[[^\]]+\]\s*/, '').trim();
}

function isProgressBlockTitle(line: string): boolean {
  return ['Final output', 'Assistant message', 'Review output'].includes(line);
}

export function readJobProgressPreview(
  logFile: string | null | undefined,
  maxLines = DEFAULT_MAX_PROGRESS_LINES,
): string[] {
  if (!logFile || !existsSync(logFile)) {
    return [];
  }

  return readFileSync(logFile, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean)
    .filter(line => line.startsWith('['))
    .map(stripLogPrefix)
    .filter(line => line && !isProgressBlockTitle(line))
    .slice(-maxLines);
}

function formatElapsedDuration(
  startValue: string | undefined,
  endValue: string | null = null,
): string | null {
  const start = Date.parse(startValue ?? '');

  if (!Number.isFinite(start)) {
    return null;
  }

  const end = endValue ? Date.parse(endValue) : Date.now();

  if (!Number.isFinite(end) || end < start) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

/** The phase a job without a stored phase is in, as far as its status tells. */
function inferPhase(job: Job): string {
  switch (job.status) {
    case 'queued':
      return 'queued';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
      return 'failed';
    case 'completed':
      return 'done';
    default:
      return job.jobClass === 'review' ? 'reviewing' : 'running';
  }
}

/** Adds the type label, the log preview and the elapsed time to a job for the status report. */
export function enrichJob(
  job: Job,
  options: { maxProgressLines?: number } = {},
): EnrichedJob {
  const maxProgressLines =
    options.maxProgressLines ?? DEFAULT_MAX_PROGRESS_LINES;

  const showsProgress =
    job.status === 'queued' ||
    job.status === 'running' ||
    job.status === 'failed';

  const isFinished =
    job.status === 'completed' ||
    job.status === 'failed' ||
    job.status === 'cancelled';

  return {
    ...job,
    kindLabel: getJobTypeLabel(job),
    progressPreview: showsProgress
      ? readJobProgressPreview(job.logFile, maxProgressLines)
      : [],
    elapsed: formatElapsedDuration(
      job.startedAt ?? job.createdAt,
      job.completedAt ?? null,
    ),
    duration: isFinished
      ? formatElapsedDuration(
          job.startedAt ?? job.createdAt,
          job.completedAt ?? job.updatedAt,
        )
      : null,
    phase: job.phase ?? inferPhase(job),
  };
}

export function readStoredJob(
  workspaceRoot: string,
  jobId: string,
): StoredJob | null {
  const jobFile = resolveJobFile(workspaceRoot, jobId);

  return existsSync(jobFile) ? readJobFile(jobFile) : null;
}

function matchJobReference(
  jobs: Job[],
  reference: string,
  predicate: (job: Job) => boolean = () => true,
): Job | null {
  const filtered = jobs.filter(predicate);

  if (!reference) {
    return filtered[0] ?? null;
  }

  const exact = filtered.find(job => job.id === reference);

  if (exact) {
    return exact;
  }

  const prefixMatches = filtered.filter(job => job.id.startsWith(reference));

  if (prefixMatches.length === 1) {
    return prefixMatches[0];
  }

  if (prefixMatches.length > 1) {
    throw new Error(
      `Job reference "${reference}" is ambiguous. Use a longer job id.`,
    );
  }

  throw new Error(
    `No job found for "${reference}". Run /antigravity:status to list known jobs.`,
  );
}

export function buildStatusSnapshot(
  cwd: string,
  options: {
    all?: boolean;
    maxJobs?: number;
    maxProgressLines?: number;
    env?: NodeJS.ProcessEnv;
  } = {},
): StatusSnapshot {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const config = getConfig(workspaceRoot);

  const jobs = sortJobsNewestFirst(
    filterJobsForCurrentSession(listJobs(workspaceRoot), options),
  );

  const maxJobs = options.maxJobs ?? DEFAULT_MAX_STATUS_JOBS;
  const maxProgressLines =
    options.maxProgressLines ?? DEFAULT_MAX_PROGRESS_LINES;

  const running = jobs
    .filter(isActiveJob)
    .map(job => enrichJob(job, { maxProgressLines }));

  const latestFinishedRaw = jobs.find(job => !isActiveJob(job)) ?? null;

  const latestFinished = latestFinishedRaw
    ? enrichJob(latestFinishedRaw, { maxProgressLines })
    : null;

  const recent = (options.all ? jobs : jobs.slice(0, maxJobs))
    .filter(job => !isActiveJob(job) && job.id !== latestFinished?.id)
    .map(job => enrichJob(job, { maxProgressLines }));

  return {
    workspaceRoot,
    config,
    running,
    latestFinished,
    recent,
    needsReview: Boolean(config.stopReviewGate),
  };
}

export function buildSingleJobSnapshot(
  cwd: string,
  reference: string,
  options: { maxProgressLines?: number } = {},
): { workspaceRoot: string; job: EnrichedJob } {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot));
  const selected = matchJobReference(jobs, reference);

  if (!selected) {
    throw new Error(
      `No job found for "${reference}". Run /antigravity:status to inspect known jobs.`,
    );
  }

  return {
    workspaceRoot,
    job: enrichJob(selected, { maxProgressLines: options.maxProgressLines }),
  };
}

export function resolveResultJob(
  cwd: string,
  reference: string,
): { workspaceRoot: string; job: Job } {
  const workspaceRoot = resolveWorkspaceRoot(cwd);

  const jobs = sortJobsNewestFirst(
    reference
      ? listJobs(workspaceRoot)
      : filterJobsForCurrentSession(listJobs(workspaceRoot)),
  );

  // A named job is looked up among all jobs, so that a job which still runs gets its own message and not "not found".
  const named = reference ? matchJobReference(jobs, reference) : null;

  if (named && isActiveJob(named)) {
    throw new Error(
      `Job ${named.id} is still ${named.status}. Check /antigravity:status and try again once it finishes.`,
    );
  }

  const selected = named ?? jobs.find(job => !isActiveJob(job)) ?? null;

  if (selected) {
    return { workspaceRoot, job: selected };
  }

  const active = jobs.find(isActiveJob);

  if (active) {
    throw new Error(
      `Job ${active.id} is still ${active.status}. Check /antigravity:status and try again once it finishes.`,
    );
  }

  throw new Error(
    'No finished Antigravity jobs found for this repository yet.',
  );
}

export function resolveCancelableJob(
  cwd: string,
  reference: string,
  options: LookupOptions = {},
): { workspaceRoot: string; job: Job } {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot));
  const activeJobs = jobs.filter(isActiveJob);

  if (reference) {
    const selected = matchJobReference(activeJobs, reference);

    if (!selected) {
      throw new Error(`No active job found for "${reference}".`);
    }

    return { workspaceRoot, job: selected };
  }

  const sessionScopedActiveJobs = filterJobsForCurrentSession(
    activeJobs,
    options,
  );

  if (sessionScopedActiveJobs.length === 1) {
    return { workspaceRoot, job: sessionScopedActiveJobs[0] };
  }

  if (sessionScopedActiveJobs.length > 1) {
    throw new Error(
      'Multiple Antigravity jobs are active. Pass a job id to /antigravity:cancel.',
    );
  }

  if (getCurrentSessionId(options)) {
    throw new Error('No active Antigravity jobs to cancel for this session.');
  }

  throw new Error('No active Antigravity jobs to cancel.');
}

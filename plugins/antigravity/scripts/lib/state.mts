// Ported from scripts/lib/state.mjs of the OpenAI Codex plugin for Claude Code 1.0.6 (Apache-2.0 License, Copyright 2026 OpenAI).

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import type { Job, State, StoredJob } from './types.mts';
import { resolveWorkspaceRoot } from './workspace.mts';

const STATE_VERSION = 1;
const PLUGIN_DATA_ENV = 'CLAUDE_PLUGIN_DATA';

export const COMPANION_DATA_ENV = 'ANTIGRAVITY_COMPANION_DATA';

const FALLBACK_STATE_ROOT_DIR = join(tmpdir(), 'antigravity-companion');
const STATE_FILE_NAME = 'state.json';
const JOBS_DIR_NAME = 'jobs';
const MAX_JOBS = 50;

function nowIso(): string {
  return new Date().toISOString();
}

function defaultState(): State {
  return {
    version: STATE_VERSION,
    config: { stopReviewGate: false },
    jobs: [],
  };
}

/** The folder of the state of a workspace, named by the folder name and a hash of its real path. */
export function resolveStateDir(cwd: string): string {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  let canonicalWorkspaceRoot = workspaceRoot;

  try {
    canonicalWorkspaceRoot = realpathSync.native(workspaceRoot);
  } catch {
    canonicalWorkspaceRoot = workspaceRoot;
  }

  const slugSource = basename(workspaceRoot) || 'workspace';

  const slug =
    slugSource.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') ||
    'workspace';

  const hash = createHash('sha256')
    .update(canonicalWorkspaceRoot)
    .digest('hex')
    .slice(0, 16);

  const dataDir = resolveDataDir();
  const stateRoot = dataDir ? join(dataDir, 'state') : FALLBACK_STATE_ROOT_DIR;

  return join(stateRoot, `${slug}-${hash}`);
}

/**
 * Returns the data folder of this plugin, which the SessionStart hook hands to Bash calls under its own name, because another plugin's hook may export its own CLAUDE_PLUGIN_DATA for every Bash call of the session.
 * @see {@link https://code.claude.com/docs/en/plugins-reference.md#environment-variables | Plugin environment variables}
 */
function resolveDataDir(): string | undefined {
  const companionData = process.env[COMPANION_DATA_ENV];

  if (companionData) {
    return companionData;
  }

  const pluginData = process.env[PLUGIN_DATA_ENV];

  return pluginData && basename(pluginData).startsWith('antigravity-')
    ? pluginData
    : undefined;
}

export function resolveStateFile(cwd: string): string {
  return join(resolveStateDir(cwd), STATE_FILE_NAME);
}

function resolveJobsDir(cwd: string): string {
  return join(resolveStateDir(cwd), JOBS_DIR_NAME);
}

function ensureStateDir(cwd: string): void {
  mkdirSync(resolveJobsDir(cwd), { recursive: true });
}

export function loadState(cwd: string): State {
  const stateFile = resolveStateFile(cwd);

  if (!existsSync(stateFile)) {
    return defaultState();
  }

  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8'));

    return {
      ...defaultState(),
      ...parsed,
      config: { ...defaultState().config, ...parsed.config },
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    };
  } catch {
    return defaultState();
  }
}

function pruneJobs(jobs: Job[]): Job[] {
  return [...jobs]
    .sort((left, right) =>
      String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')),
    )
    .slice(0, MAX_JOBS);
}

function removeFileIfExists(filePath: string | null | undefined): void {
  if (filePath && existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

export function saveState(cwd: string, state: State): State {
  const previousJobs = loadState(cwd).jobs;

  ensureStateDir(cwd);

  const nextJobs = pruneJobs(state.jobs);

  const nextState: State = {
    version: STATE_VERSION,
    config: { ...defaultState().config, ...state.config },
    jobs: nextJobs,
  };

  const retainedIds = new Set(nextJobs.map(job => job.id));

  for (const job of previousJobs) {
    if (!retainedIds.has(job.id)) {
      removeFileIfExists(resolveJobFile(cwd, job.id));
      removeFileIfExists(job.logFile);
    }
  }

  writeFileSync(
    resolveStateFile(cwd),
    `${JSON.stringify(nextState, null, 2)}\n`,
    'utf8',
  );

  return nextState;
}

function updateState(cwd: string, mutate: (state: State) => void): State {
  const state = loadState(cwd);

  mutate(state);

  return saveState(cwd, state);
}

export function generateJobId(prefix = 'job'): string {
  const random = Math.random().toString(36).slice(2, 8);

  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

/** Adds the job to the state, or merges the patch into the job with the same id. */
export function upsertJob(
  cwd: string,
  jobPatch: Partial<Job> & { id: string },
): State {
  return updateState(cwd, state => {
    const timestamp = nowIso();
    const existingIndex = state.jobs.findIndex(job => job.id === jobPatch.id);

    if (existingIndex === -1) {
      state.jobs.unshift({
        createdAt: timestamp,
        updatedAt: timestamp,
        ...jobPatch,
      });

      return;
    }

    state.jobs[existingIndex] = {
      ...state.jobs[existingIndex],
      ...jobPatch,
      updatedAt: timestamp,
    };
  });
}

export function listJobs(cwd: string): Job[] {
  return loadState(cwd).jobs;
}

export function setConfig(
  cwd: string,
  key: keyof State['config'],
  value: boolean,
): State {
  return updateState(cwd, state => {
    state.config = { ...state.config, [key]: value };
  });
}

export function getConfig(cwd: string): State['config'] {
  return loadState(cwd).config;
}

export function writeJobFile(
  cwd: string,
  jobId: string,
  payload: StoredJob,
): string {
  ensureStateDir(cwd);

  const jobFile = resolveJobFile(cwd, jobId);

  writeFileSync(jobFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  return jobFile;
}

export function readJobFile(jobFile: string): StoredJob {
  return JSON.parse(readFileSync(jobFile, 'utf8'));
}

export function resolveJobLogFile(cwd: string, jobId: string): string {
  ensureStateDir(cwd);

  return join(resolveJobsDir(cwd), `${jobId}.log`);
}

export function resolveJobFile(cwd: string, jobId: string): string {
  ensureStateDir(cwd);

  return join(resolveJobsDir(cwd), `${jobId}.json`);
}

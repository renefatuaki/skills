// Ported from scripts/lib/tracked-jobs.mjs of the OpenAI Codex plugin for Claude Code 1.0.6 (Apache-2.0 License, Copyright 2026 OpenAI).

import { appendFileSync, existsSync, writeFileSync } from 'node:fs';

import {
  readJobFile,
  resolveJobFile,
  resolveJobLogFile,
  upsertJob,
  writeJobFile,
} from './state.mts';
import type {
  Execution,
  Job,
  ProgressEvent,
  ProgressReporter,
  StoredJob,
} from './types.mts';

export const SESSION_ID_ENV = 'ANTIGRAVITY_COMPANION_SESSION_ID';

export function nowIso(): string {
  return new Date().toISOString();
}

/** A progress event with every field filled, empty when the event named nothing. */
type NormalizedEvent = {
  message: string;
  phase: string | null;
  conversationId: string | null;
  stderrMessage: string | null;
  logTitle: string | null;
  logBody: string | null;
};

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function normalizeProgressEvent(
  value: ProgressEvent | string,
): NormalizedEvent {
  if (typeof value === 'object') {
    return {
      message: String(value.message ?? '').trim(),
      phase: nonEmpty(value.phase),
      conversationId: nonEmpty(value.conversationId),
      stderrMessage:
        value.stderrMessage == null ? null : String(value.stderrMessage).trim(),
      logTitle: nonEmpty(value.logTitle),
      logBody: value.logBody == null ? null : String(value.logBody).trimEnd(),
    };
  }

  return {
    message: String(value).trim(),
    phase: null,
    conversationId: null,
    stderrMessage: String(value).trim(),
    logTitle: null,
    logBody: null,
  };
}

export function appendLogLine(
  logFile: string | null | undefined,
  message: string,
): void {
  const normalized = String(message).trim();

  if (!logFile || normalized === '') {
    return;
  }

  appendFileSync(logFile, `[${nowIso()}] ${normalized}\n`, 'utf8');
}

function appendLogBlock(
  logFile: string | null | undefined,
  title: string | null,
  body: string | null,
): void {
  if (!logFile || !title || !body) {
    return;
  }

  appendFileSync(
    logFile,
    `\n[${nowIso()}] ${title}\n${String(body).trimEnd()}\n`,
    'utf8',
  );
}

export function createJobLogFile(
  workspaceRoot: string,
  jobId: string,
  title: string,
): string {
  const logFile = resolveJobLogFile(workspaceRoot, jobId);

  writeFileSync(logFile, '', 'utf8');

  if (title) {
    appendLogLine(logFile, `Starting ${title}.`);
  }

  return logFile;
}

/** Stamps the job with its creation time and with the id of the Claude session that started it. */
export function createJobRecord(base: Job): Job {
  const sessionId = process.env[SESSION_ID_ENV];

  return {
    ...base,
    createdAt: nowIso(),
    ...(sessionId ? { sessionId } : {}),
  };
}

/** Builds the callback that stores a changed phase or conversation id on the job. */
export function createJobProgressUpdater(
  workspaceRoot: string,
  jobId: string,
): (event: ProgressEvent | string) => void {
  let lastPhase: string | null = null;
  let lastConversationId: string | null = null;

  return event => {
    const normalized = normalizeProgressEvent(event);
    const patch: Partial<Job> & { id: string } = { id: jobId };
    let changed = false;

    if (normalized.phase && normalized.phase !== lastPhase) {
      lastPhase = normalized.phase;
      patch.phase = normalized.phase;
      changed = true;
    }

    if (
      normalized.conversationId &&
      normalized.conversationId !== lastConversationId
    ) {
      lastConversationId = normalized.conversationId;
      patch.conversationId = normalized.conversationId;
      changed = true;
    }

    if (!changed) {
      return;
    }

    upsertJob(workspaceRoot, patch);

    const jobFile = resolveJobFile(workspaceRoot, jobId);

    if (!existsSync(jobFile)) {
      return;
    }

    writeJobFile(workspaceRoot, jobId, { ...readJobFile(jobFile), ...patch });
  };
}

/** Builds the reporter that writes each event to stderr, to the log and to the job, or nothing when no sink is on. */
export function createProgressReporter(
  options: {
    stderr?: boolean;
    logFile?: string | null;
    onEvent?: ((event: ProgressEvent) => void) | null;
  } = {},
): ProgressReporter | null {
  const { stderr = false, logFile = null, onEvent = null } = options;

  if (!stderr && !logFile && !onEvent) {
    return null;
  }

  return eventOrMessage => {
    const event = normalizeProgressEvent(eventOrMessage);
    const stderrMessage = event.stderrMessage ?? event.message;

    if (stderr && stderrMessage) {
      process.stderr.write(`[antigravity] ${stderrMessage}\n`);
    }

    appendLogLine(logFile, event.message);
    appendLogBlock(logFile, event.logTitle, event.logBody);
    onEvent?.({
      phase: event.phase ?? undefined,
      conversationId: event.conversationId ?? undefined,
    });
  };
}

function readStoredJobOrNull(
  workspaceRoot: string,
  jobId: string,
): StoredJob | null {
  const jobFile = resolveJobFile(workspaceRoot, jobId);

  return existsSync(jobFile) ? readJobFile(jobFile) : null;
}

/** Runs the runner while the job file and the state hold the job as running, and stores how it ended. */
export async function runTrackedJob(
  job: Job & { workspaceRoot: string },
  runner: () => Promise<Execution>,
  options: { logFile?: string | null } = {},
): Promise<Execution> {
  const runningRecord: StoredJob = {
    ...job,
    status: 'running',
    startedAt: nowIso(),
    phase: 'starting',
    pid: process.pid,
    logFile: options.logFile ?? job.logFile ?? null,
  };

  writeJobFile(job.workspaceRoot, job.id, runningRecord);
  upsertJob(job.workspaceRoot, runningRecord);

  try {
    const execution = await runner();
    const completionStatus =
      execution.exitStatus === 0 ? 'completed' : 'failed';

    const phase = completionStatus === 'completed' ? 'done' : 'failed';
    const completedAt = nowIso();

    writeJobFile(job.workspaceRoot, job.id, {
      ...runningRecord,
      status: completionStatus,
      conversationId: execution.conversationId,
      pid: null,
      agyPid: null,
      phase,
      completedAt,
      result: execution.payload,
      rendered: execution.rendered,
    });

    upsertJob(job.workspaceRoot, {
      id: job.id,
      status: completionStatus,
      conversationId: execution.conversationId,
      summary: execution.summary,
      phase,
      pid: null,
      agyPid: null,
      completedAt,
    });

    appendLogBlock(
      options.logFile ?? job.logFile ?? null,
      'Final output',
      execution.rendered,
    );

    return execution;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    const existing =
      readStoredJobOrNull(job.workspaceRoot, job.id) ?? runningRecord;

    const completedAt = nowIso();

    writeJobFile(job.workspaceRoot, job.id, {
      ...existing,
      status: 'failed',
      phase: 'failed',
      errorMessage,
      pid: null,
      agyPid: null,
      completedAt,
      logFile: options.logFile ?? job.logFile ?? existing.logFile ?? null,
    });

    upsertJob(job.workspaceRoot, {
      id: job.id,
      status: 'failed',
      phase: 'failed',
      pid: null,
      agyPid: null,
      errorMessage,
      completedAt,
    });

    throw error;
  }
}

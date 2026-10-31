#!/usr/bin/env node

// Ported from scripts/codex-companion.mjs of the OpenAI Codex plugin for Claude Code 1.0.6 (Apache-2.0 License, Copyright 2026 OpenAI).
// The Codex app server and its broker are replaced by one `agy -p ... --output-format json` child process per run, and the transfer subcommand is dropped because `agy` cannot import a Claude session.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_CONTINUE_PROMPT,
  DEFAULT_TIMEOUT_MINUTES,
  getAgyAuthStatus,
  getAgyAvailability,
  INSTALL_URL,
  normalizeEffort,
  normalizeModel,
  NOT_INSTALLED,
  readUsage,
  runAgy,
} from './lib/agy.mts';
import type { AgyRun } from './lib/agy.mts';
import { parseArgs, splitRawArgumentString } from './lib/args.mts';
import type { ArgsConfig, ParsedArgs } from './lib/args.mts';
import { readStdinIfPiped } from './lib/fs.mts';
import {
  collectReviewContext,
  ensureGitRepository,
  resolveReviewTarget,
} from './lib/git.mts';
import type { ReviewContext, ReviewTarget } from './lib/git.mts';
import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  filterJobsForCurrentSession,
  getCurrentSessionId,
  isActiveJob,
  readStoredJob,
  resolveCancelableJob,
  resolveResultJob,
  sortJobsNewestFirst,
} from './lib/job-control.mts';
import { binaryAvailable, terminateProcessTree } from './lib/process.mts';
import { interpolateTemplate, loadPromptTemplate } from './lib/prompts.mts';
import {
  renderCancelReport,
  renderJobStatusReport,
  renderReviewFailure,
  renderReviewResult,
  renderSetupReport,
  renderStatusReport,
  renderStoredJobResult,
  renderTaskResult,
} from './lib/render.mts';
import type { ParsedReview, SetupReport } from './lib/render.mts';
import {
  generateJobId,
  getConfig,
  listJobs,
  readJobFile,
  resolveJobFile,
  resolveStateDir,
  setConfig,
  upsertJob,
  writeJobFile,
} from './lib/state.mts';
import {
  appendLogLine,
  createJobLogFile,
  createJobProgressUpdater,
  createJobRecord,
  createProgressReporter,
  nowIso,
  runTrackedJob,
} from './lib/tracked-jobs.mts';
import type {
  Execution,
  Job,
  JobClass,
  ProgressReporter,
  TaskRequest,
} from './lib/types.mts';
import { resolveWorkspaceRoot } from './lib/workspace.mts';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT_DIR = resolve(dirname(SCRIPT_PATH), '..');
const REVIEW_SCHEMA = join(ROOT_DIR, 'schemas', 'review-output.schema.json');
const DEFAULT_STATUS_WAIT_TIMEOUT_MS = 240000;
const DEFAULT_STATUS_POLL_INTERVAL_MS = 2000;
const STOP_REVIEW_TASK_MARKER =
  'Run a stop-gate review of the previous Claude turn.';

/** The two reviews, which differ in their prompt and in whether they take a focus text. */
type ReviewName = 'Review' | 'Adversarial Review';

type ReviewRequest = {
  cwd: string;
  base?: string;
  scope?: string;
  model: string | null;
  effort: string | null;
  focusText: string;
  reviewName: ReviewName;
  timeoutMinutes: number | null;
  jobId: string | null;
  onProgress: ProgressReporter | null;
};

/** What a run hands back to the tracker, with the job fields the report needs. */
type RunExecution = Execution & { jobTitle: string; jobClass: JobClass };

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  node scripts/antigravity-companion.mts setup [--enable-review-gate|--disable-review-gate] [--json]',
      '  node scripts/antigravity-companion.mts review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>] [--model <model>] [--effort <effort>] [--timeout <minutes>]',
      '  node scripts/antigravity-companion.mts adversarial-review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>] [--model <model>] [--effort <effort>] [--timeout <minutes>] [focus text]',
      '  node scripts/antigravity-companion.mts task [--background] [--write] [--resume-last|--resume|--fresh] [--model <flash|pro|argon|carbon|gemini-...>] [--effort <low|medium|high|xhigh|max>] [--timeout <minutes>] [--prompt-file <path>] [prompt]',
      '  node scripts/antigravity-companion.mts status [job-id] [--wait] [--timeout-ms <ms>] [--all] [--json]',
      '  node scripts/antigravity-companion.mts result [job-id] [--json]',
      '  node scripts/antigravity-companion.mts cancel [job-id] [--json]',
    ].join('\n'),
  );
}

function outputResult(value: unknown, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(String(value));
  }
}

function outputCommandResult(
  payload: unknown,
  rendered: string,
  asJson: boolean,
): void {
  outputResult(asJson ? payload : rendered, asJson);
}

function str(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function normalizeArgv(argv: string[]): string[] {
  if (argv.length === 1) {
    const [raw] = argv;

    if (!raw || !raw.trim()) {
      return [];
    }

    return splitRawArgumentString(raw);
  }

  return argv;
}

function parseCommandInput(
  argv: string[],
  config: ArgsConfig = {},
): ParsedArgs {
  return parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: { C: 'cwd', ...config.aliasMap },
  });
}

function resolveCommandCwd(options: ParsedArgs['options']): string {
  const cwd = str(options.cwd);

  return cwd ? resolve(process.cwd(), cwd) : process.cwd();
}

function resolveCommandWorkspace(options: ParsedArgs['options']): string {
  return resolveWorkspaceRoot(resolveCommandCwd(options));
}

function sleep(ms: number): Promise<void> {
  return new Promise(done => setTimeout(done, ms));
}

function shorten(value: string, limit = 96): string {
  const normalized = value.trim().replace(/\s+/g, ' ');

  if (!normalized) {
    return '';
  }

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit - 3)}...`;
}

function firstMeaningfulLine(value: string, fallback: string): string {
  const line = value
    .split(/\r?\n/)
    .map(candidate => candidate.trim())
    .find(Boolean);

  return line ?? fallback;
}

/** Reads --timeout as a whole number of minutes above 0. */
function parseTimeoutMinutes(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(
      `Unsupported timeout "${value}". Use a whole number of minutes above 0.`,
    );
  }

  return Number(value);
}

function buildSetupReport(cwd: string, actionsTaken: string[]): SetupReport {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const nodeStatus = binaryAvailable('node', ['--version'], { cwd });
  const agyStatus = getAgyAvailability(cwd);
  const authStatus = getAgyAuthStatus(cwd);
  const config = getConfig(workspaceRoot);

  const usage = authStatus.loggedIn
    ? readUsage(cwd)
    : { available: false, groups: [], detail: 'needs a signed-in account' };

  const nextSteps: string[] = [];

  if (!agyStatus.available) {
    nextSteps.push(
      `Install the Antigravity CLI from ${INSTALL_URL}, then rerun /antigravity:setup.`,
    );
  }

  if (agyStatus.available && !authStatus.loggedIn) {
    nextSteps.push('Run `!agy` to sign in interactively.');
  }

  if (!config.stopReviewGate) {
    nextSteps.push(
      'Optional: run `/antigravity:setup --enable-review-gate` to require a fresh review before stop.',
    );
  }

  return {
    ready: nodeStatus.available && agyStatus.available && authStatus.loggedIn,
    node: nodeStatus,
    agy: agyStatus,
    auth: authStatus,
    usage,
    reviewGateEnabled: Boolean(config.stopReviewGate),
    actionsTaken,
    nextSteps,
  };
}

function handleSetup(argv: string[]): void {
  const { options } = parseCommandInput(argv, {
    valueOptions: ['cwd'],
    booleanOptions: ['json', 'enable-review-gate', 'disable-review-gate'],
  });

  if (options['enable-review-gate'] && options['disable-review-gate']) {
    throw new Error(
      'Choose either --enable-review-gate or --disable-review-gate.',
    );
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const actionsTaken: string[] = [];

  if (options['enable-review-gate']) {
    setConfig(workspaceRoot, 'stopReviewGate', true);
    actionsTaken.push(
      `Enabled the stop-time review gate for ${workspaceRoot}.`,
    );
  } else if (options['disable-review-gate']) {
    setConfig(workspaceRoot, 'stopReviewGate', false);
    actionsTaken.push(
      `Disabled the stop-time review gate for ${workspaceRoot}.`,
    );
  }

  const finalReport = buildSetupReport(cwd, actionsTaken);

  outputResult(
    options.json ? finalReport : renderSetupReport(finalReport),
    Boolean(options.json),
  );
}

function ensureAgyAvailable(cwd: string): void {
  if (!getAgyAvailability(cwd).available) {
    throw new Error(NOT_INSTALLED);
  }
}

function buildReviewPrompt(
  context: ReviewContext,
  reviewName: ReviewName,
  focusText: string,
): string {
  const template = loadPromptTemplate(
    ROOT_DIR,
    reviewName === 'Review' ? 'review' : 'adversarial-review',
  );

  return interpolateTemplate(template, {
    REVIEW_KIND: reviewName,
    TARGET_LABEL: context.target.label,
    USER_FOCUS: focusText || 'No extra focus provided.',
    REVIEW_COLLECTION_GUIDANCE: context.collectionGuidance,
    REVIEW_INPUT: context.content,
  });
}

function validateReviewRequest(
  reviewName: ReviewName,
  focusText: string,
): void {
  if (reviewName === 'Review' && focusText.trim()) {
    throw new Error(
      `\`/antigravity:review\` does not support custom focus text. Retry with \`/antigravity:adversarial-review ${focusText.trim()}\` for focused review instructions.`,
    );
  }
}

function findLatestResumableTaskJob(jobs: Job[]): Job | null {
  return (
    jobs.find(
      job => job.jobClass === 'task' && job.conversationId && !isActiveJob(job),
    ) ?? null
  );
}

async function waitForSingleJobSnapshot(
  cwd: string,
  reference: string,
  options: { timeoutMs?: string; pollIntervalMs?: string } = {},
) {
  const timeoutMs = Math.max(
    0,
    Number(options.timeoutMs) || DEFAULT_STATUS_WAIT_TIMEOUT_MS,
  );

  const pollIntervalMs = Math.max(
    100,
    Number(options.pollIntervalMs) || DEFAULT_STATUS_POLL_INTERVAL_MS,
  );

  const deadline = Date.now() + timeoutMs;
  let snapshot = buildSingleJobSnapshot(cwd, reference);

  while (isActiveJob(snapshot.job) && Date.now() < deadline) {
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    snapshot = buildSingleJobSnapshot(cwd, reference);
  }

  return {
    ...snapshot,
    waitTimedOut: isActiveJob(snapshot.job),
    timeoutMs,
  };
}

/** Finds the conversation of the latest finished task of this Claude session, and refuses while a task of it still runs. */
function resolveLatestTrackedConversation(
  cwd: string,
  excludeJobId: string | null,
): string | null {
  const workspaceRoot = resolveWorkspaceRoot(cwd);

  const visibleJobs = filterJobsForCurrentSession(
    sortJobsNewestFirst(listJobs(workspaceRoot)).filter(
      job => job.id !== excludeJobId,
    ),
  );

  const activeTask = visibleJobs.find(
    job => job.jobClass === 'task' && isActiveJob(job),
  );

  if (activeTask) {
    throw new Error(
      `Task ${activeTask.id} is still running. Use /antigravity:status before continuing it.`,
    );
  }

  return findLatestResumableTaskJob(visibleJobs)?.conversationId ?? null;
}

/** Stores the pid of the `agy` child on the job, so that cancel can stop its process group. */
function recordAgyPid(
  workspaceRoot: string,
  jobId: string | null,
  pid: number,
): void {
  if (jobId === null) {
    return;
  }

  upsertJob(workspaceRoot, { id: jobId, agyPid: pid });

  const jobFile = resolveJobFile(workspaceRoot, jobId);

  writeJobFile(workspaceRoot, jobId, {
    ...readJobFile(jobFile),
    agyPid: pid,
  });
}

/** Reads the review JSON from the structured output of the run, else from its response text. */
function parseStructuredOutput(run: AgyRun): ParsedReview {
  const structured = run.structuredOutput;

  if (typeof structured === 'object' && structured !== null) {
    return {
      parsed: structured,
      parseError: null,
      rawOutput: JSON.stringify(structured, null, 2),
    };
  }

  const rawOutput = typeof structured === 'string' ? structured : run.response;

  if (!rawOutput) {
    return {
      parsed: null,
      parseError: 'Antigravity did not return a structured review.',
      rawOutput: '',
    };
  }

  const unfenced = rawOutput
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  try {
    return { parsed: JSON.parse(unfenced), parseError: null, rawOutput };
  } catch (error) {
    return {
      parsed: null,
      parseError: error instanceof Error ? error.message : String(error),
      rawOutput,
    };
  }
}

async function executeReviewRun(request: ReviewRequest): Promise<RunExecution> {
  ensureAgyAvailable(request.cwd);
  ensureGitRepository(request.cwd);

  const target: ReviewTarget = resolveReviewTarget(request.cwd, {
    base: request.base,
    scope: request.scope,
  });

  const reviewName = request.reviewName;
  const focusText = request.focusText.trim();

  validateReviewRequest(reviewName, focusText);

  const context = collectReviewContext(request.cwd, target);
  const workspaceRoot = resolveWorkspaceRoot(context.repoRoot);
  const prompt = buildReviewPrompt(context, reviewName, focusText);

  const run = await runAgy({
    cwd: context.repoRoot,
    prompt,
    model: request.model,
    effort: request.effort,
    write: false,
    jsonSchema: REVIEW_SCHEMA,
    timeoutMinutes: request.timeoutMinutes,
    phase: 'reviewing',
    guardIgnoreDir: resolveStateDir(workspaceRoot),
    onSpawn: pid => recordAgyPid(workspaceRoot, request.jobId, pid),
    onProgress: request.onProgress,
  });

  const meta = {
    reviewLabel: reviewName,
    targetLabel: context.target.label,
    notes: run.notes,
  };

  const parsed: ParsedReview = run.ok
    ? parseStructuredOutput(run)
    : { parsed: null, parseError: run.failure, rawOutput: run.response };

  const payload = {
    review: reviewName,
    target,
    conversationId: run.conversationId,
    context: {
      repoRoot: context.repoRoot,
      branch: context.branch,
      summary: context.summary,
    },
    antigravity: {
      status: run.status,
      stderr: run.stderr,
      stdout: run.response,
      notes: run.notes,
    },
    result: parsed.parsed,
    rawOutput: parsed.rawOutput,
    parseError: parsed.parseError,
    failure: run.failure,
    changedFiles: run.changedFiles,
  };

  return {
    exitStatus: run.ok ? 0 : 1,
    conversationId: run.conversationId,
    payload,
    rendered: run.ok
      ? renderReviewResult(parsed, meta)
      : renderReviewFailure(run.failure ?? '', meta),
    summary: summarizeReview(run, parsed, reviewName),
    jobTitle: `Antigravity ${reviewName}`,
    jobClass: 'review',
  };
}

function summarizeReview(
  run: AgyRun,
  parsed: ParsedReview,
  reviewName: ReviewName,
): string {
  if (!run.ok) {
    return firstMeaningfulLine(run.failure ?? '', `${reviewName} failed.`);
  }

  const summary = (parsed.parsed as { summary?: unknown } | null)?.summary;

  if (typeof summary === 'string' && summary) {
    return summary;
  }

  return (
    parsed.parseError ??
    firstMeaningfulLine(run.response, `${reviewName} finished.`)
  );
}

async function executeTaskRun(
  request: TaskRequest & { onProgress?: ProgressReporter | null },
): Promise<RunExecution> {
  const workspaceRoot = resolveWorkspaceRoot(request.cwd);

  ensureAgyAvailable(request.cwd);

  const taskMetadata = buildTaskRunMetadata(request.prompt, request.resumeLast);

  let resumeConversationId: string | null = null;

  if (request.resumeLast) {
    resumeConversationId = resolveLatestTrackedConversation(
      workspaceRoot,
      request.jobId,
    );

    if (!resumeConversationId) {
      throw new Error(
        'No previous Antigravity conversation was found for this repository.',
      );
    }
  }

  if (!request.prompt && !resumeConversationId) {
    throw new Error(
      'Provide a prompt, a prompt file, piped stdin, or use --resume-last.',
    );
  }

  const run = await runAgy({
    cwd: workspaceRoot,
    prompt: request.prompt || DEFAULT_CONTINUE_PROMPT,
    model: request.model,
    effort: request.effort,
    write: request.write,
    conversationId: resumeConversationId,
    timeoutMinutes: request.timeoutMinutes,
    guardIgnoreDir: resolveStateDir(workspaceRoot),
    onSpawn: pid => recordAgyPid(workspaceRoot, request.jobId, pid),
    onProgress: request.onProgress,
  });

  const rawOutput = run.ok ? run.response : '';

  const responseBlock =
    !run.ok && run.response ? `\n\nResponse of the run:\n${run.response}` : '';

  const failureMessage = `${run.failure ?? ''}${responseBlock}`;

  const rendered = renderTaskResult({
    rawOutput,
    failureMessage,
    notes: run.notes,
  });

  const payload = {
    status: run.ok ? 'completed' : 'failed',
    conversationId: run.conversationId,
    rawOutput,
    failure: run.failure,
    notes: run.notes,
    changedFiles: run.changedFiles,
  };

  return {
    exitStatus: run.ok ? 0 : 1,
    conversationId: run.conversationId,
    payload,
    rendered,
    summary: firstMeaningfulLine(
      rawOutput,
      firstMeaningfulLine(run.failure ?? '', `${taskMetadata.title} finished.`),
    ),
    jobTitle: taskMetadata.title,
    jobClass: 'task',
  };
}

function buildReviewJobMetadata(reviewName: ReviewName, target: ReviewTarget) {
  return {
    kind: reviewName === 'Adversarial Review' ? 'adversarial-review' : 'review',
    title: `Antigravity ${reviewName}`,
    summary: `${reviewName} ${target.label}`,
  };
}

function buildTaskRunMetadata(
  prompt: string,
  resumeLast = false,
): { title: string; summary: string } {
  if (!resumeLast && prompt.includes(STOP_REVIEW_TASK_MARKER)) {
    return {
      title: 'Antigravity Stop Gate Review',
      summary: 'Stop-gate review of previous Claude turn',
    };
  }

  return {
    title: resumeLast ? 'Antigravity Resume' : 'Antigravity Task',
    summary: shorten(prompt || (resumeLast ? DEFAULT_CONTINUE_PROMPT : 'Task')),
  };
}

function renderQueuedTaskLaunch(payload: {
  title: string;
  jobId: string;
}): string {
  return `${payload.title} started in the background as ${payload.jobId}. Check /antigravity:status ${payload.jobId} for progress.\n`;
}

function getJobKindLabel(kind: string, jobClass: JobClass): string {
  if (kind === 'adversarial-review') {
    return 'adversarial-review';
  }

  return jobClass === 'review' ? 'review' : 'rescue';
}

function createCompanionJob(options: {
  prefix: string;
  kind: string;
  title: string;
  workspaceRoot: string;
  jobClass: JobClass;
  summary: string;
  write?: boolean;
}): Job & { workspaceRoot: string } {
  const job = createJobRecord({
    id: generateJobId(options.prefix),
    kind: options.kind,
    kindLabel: getJobKindLabel(options.kind, options.jobClass),
    title: options.title,
    workspaceRoot: options.workspaceRoot,
    jobClass: options.jobClass,
    summary: options.summary,
    write: options.write ?? false,
  });

  return { ...job, workspaceRoot: options.workspaceRoot };
}

function createTrackedProgress(
  job: Job & { workspaceRoot: string },
  options: { logFile?: string | null; stderr?: boolean } = {},
) {
  const logFile =
    options.logFile ??
    createJobLogFile(job.workspaceRoot, job.id, job.title ?? '');

  return {
    logFile,
    progress: createProgressReporter({
      stderr: Boolean(options.stderr),
      logFile,
      onEvent: createJobProgressUpdater(job.workspaceRoot, job.id),
    }),
  };
}

function readTaskPrompt(
  cwd: string,
  options: ParsedArgs['options'],
  positionals: string[],
): string {
  const promptFile = str(options['prompt-file']);

  if (promptFile) {
    return readFileSync(resolve(cwd, promptFile), 'utf8');
  }

  return positionals.join(' ') || readStdinIfPiped();
}

function requireTaskRequest(prompt: string, resumeLast: boolean): void {
  if (!prompt && !resumeLast) {
    throw new Error(
      'Provide a prompt, a prompt file, piped stdin, or use --resume-last.',
    );
  }
}

async function runForegroundCommand(
  job: Job & { workspaceRoot: string },
  runner: (progress: ProgressReporter | null) => Promise<RunExecution>,
  options: { json?: boolean } = {},
): Promise<void> {
  const { logFile, progress } = createTrackedProgress(job, {
    stderr: !options.json,
  });

  const execution = await runTrackedJob(job, () => runner(progress), {
    logFile,
  });

  outputResult(
    options.json ? execution.payload : execution.rendered,
    Boolean(options.json),
  );

  if (execution.exitStatus !== 0) {
    if (options.json) {
      process.stderr.write(execution.rendered);
    }

    process.exitCode = execution.exitStatus;
  }
}

function spawnDetachedTaskWorker(cwd: string, jobId: string) {
  const child = spawn(
    process.execPath,
    [SCRIPT_PATH, 'task-worker', '--cwd', cwd, '--job-id', jobId],
    {
      cwd,
      env: process.env,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  );

  child.unref();

  return child;
}

function enqueueBackgroundTask(
  cwd: string,
  job: Job & { workspaceRoot: string },
  request: TaskRequest,
) {
  const { logFile } = createTrackedProgress(job);

  appendLogLine(logFile, 'Queued for background execution.');

  const child = spawnDetachedTaskWorker(cwd, job.id);

  const queuedRecord = {
    ...job,
    status: 'queued' as const,
    phase: 'queued',
    pid: child.pid ?? null,
    logFile,
    request,
  };

  writeJobFile(job.workspaceRoot, job.id, queuedRecord);
  upsertJob(job.workspaceRoot, queuedRecord);

  return {
    payload: {
      jobId: job.id,
      status: 'queued',
      title: job.title,
      summary: job.summary,
      logFile,
    },
    logFile,
  };
}

async function handleReviewCommand(
  argv: string[],
  reviewName: ReviewName,
): Promise<void> {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ['base', 'scope', 'model', 'effort', 'timeout', 'cwd'],
    booleanOptions: ['json', 'background', 'wait'],
    aliasMap: { m: 'model' },
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const focusText = positionals.join(' ').trim();

  validateReviewRequest(reviewName, focusText);

  const model = normalizeModel(str(options.model));
  const effort = normalizeEffort(str(options.effort));

  const timeoutMinutes =
    parseTimeoutMinutes(str(options.timeout)) ??
    (options.background ? null : DEFAULT_TIMEOUT_MINUTES);

  const target = resolveReviewTarget(cwd, {
    base: str(options.base),
    scope: str(options.scope),
  });

  const metadata = buildReviewJobMetadata(reviewName, target);

  const job = createCompanionJob({
    prefix: 'review',
    kind: metadata.kind,
    title: metadata.title,
    workspaceRoot,
    jobClass: 'review',
    summary: metadata.summary,
  });

  await runForegroundCommand(
    job,
    progress =>
      executeReviewRun({
        cwd,
        base: str(options.base),
        scope: str(options.scope),
        model,
        effort,
        focusText,
        reviewName,
        timeoutMinutes,
        jobId: job.id,
        onProgress: progress,
      }),
    { json: Boolean(options.json) },
  );
}

async function handleTask(argv: string[]): Promise<void> {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ['model', 'effort', 'timeout', 'cwd', 'prompt-file'],
    booleanOptions: [
      'json',
      'write',
      'resume-last',
      'resume',
      'fresh',
      'background',
    ],
    aliasMap: { m: 'model' },
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const model = normalizeModel(str(options.model));
  const effort = normalizeEffort(str(options.effort));
  const prompt = readTaskPrompt(cwd, options, positionals);
  const resumeLast = Boolean(options['resume-last'] || options.resume);
  const fresh = Boolean(options.fresh);

  if (resumeLast && fresh) {
    throw new Error('Choose either --resume/--resume-last or --fresh.');
  }

  const write = Boolean(options.write);

  const timeoutMinutes =
    parseTimeoutMinutes(str(options.timeout)) ??
    (options.background ? null : DEFAULT_TIMEOUT_MINUTES);

  const taskMetadata = buildTaskRunMetadata(prompt, resumeLast);

  const job = createCompanionJob({
    prefix: 'task',
    kind: 'task',
    title: taskMetadata.title,
    workspaceRoot,
    jobClass: 'task',
    summary: taskMetadata.summary,
    write,
  });

  const request: TaskRequest = {
    cwd,
    model,
    effort,
    prompt,
    write,
    resumeLast,
    timeoutMinutes,
    jobId: job.id,
  };

  if (options.background) {
    ensureAgyAvailable(cwd);
    requireTaskRequest(prompt, resumeLast);

    const { payload } = enqueueBackgroundTask(cwd, job, request);

    outputCommandResult(
      payload,
      renderQueuedTaskLaunch(payload as { title: string; jobId: string }),
      Boolean(options.json),
    );

    return;
  }

  await runForegroundCommand(
    job,
    progress => executeTaskRun({ ...request, onProgress: progress }),
    { json: Boolean(options.json) },
  );
}

async function handleTaskWorker(argv: string[]): Promise<void> {
  const { options } = parseCommandInput(argv, {
    valueOptions: ['cwd', 'job-id'],
  });

  const jobId = str(options['job-id']);

  if (!jobId) {
    throw new Error('Missing required --job-id for task-worker.');
  }

  const workspaceRoot = resolveCommandWorkspace(options);
  const storedJob = readStoredJob(workspaceRoot, jobId);

  if (!storedJob) {
    throw new Error(`No stored job found for ${jobId}.`);
  }

  const request = storedJob.request;

  if (!request || typeof request !== 'object') {
    throw new Error(`Stored job ${jobId} is missing its task request payload.`);
  }

  const job = { ...storedJob, workspaceRoot };

  const { logFile, progress } = createTrackedProgress(job, {
    logFile: storedJob.logFile ?? null,
  });

  await runTrackedJob(
    { ...job, logFile },
    () => executeTaskRun({ ...request, onProgress: progress }),
    { logFile },
  );
}

async function handleStatus(argv: string[]): Promise<void> {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ['cwd', 'timeout-ms', 'poll-interval-ms'],
    booleanOptions: ['json', 'all', 'wait'],
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? '';
  const asJson = Boolean(options.json);

  if (reference) {
    const snapshot = options.wait
      ? await waitForSingleJobSnapshot(cwd, reference, {
          timeoutMs: str(options['timeout-ms']),
          pollIntervalMs: str(options['poll-interval-ms']),
        })
      : buildSingleJobSnapshot(cwd, reference);

    outputCommandResult(snapshot, renderJobStatusReport(snapshot.job), asJson);

    return;
  }

  if (options.wait) {
    throw new Error('`status --wait` requires a job id.');
  }

  const report = buildStatusSnapshot(cwd, { all: Boolean(options.all) });

  outputResult(asJson ? report : renderStatusReport(report), asJson);
}

function handleResult(argv: string[]): void {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ['cwd'],
    booleanOptions: ['json'],
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? '';
  const { workspaceRoot, job } = resolveResultJob(cwd, reference);
  const storedJob = readStoredJob(workspaceRoot, job.id);

  outputCommandResult(
    { job, storedJob },
    renderStoredJobResult(job, storedJob),
    Boolean(options.json),
  );
}

function handleTaskResumeCandidate(argv: string[]): void {
  const { options } = parseCommandInput(argv, {
    valueOptions: ['cwd'],
    booleanOptions: ['json'],
  });

  const workspaceRoot = resolveCommandWorkspace(options);
  const sessionId = getCurrentSessionId();

  const jobs = filterJobsForCurrentSession(
    sortJobsNewestFirst(listJobs(workspaceRoot)),
  );

  const candidate = findLatestResumableTaskJob(jobs);

  const payload = {
    available: Boolean(candidate),
    sessionId,
    candidate:
      candidate === null
        ? null
        : {
            id: candidate.id,
            status: candidate.status,
            title: candidate.title ?? null,
            summary: candidate.summary ?? null,
            conversationId: candidate.conversationId,
            completedAt: candidate.completedAt ?? null,
            updatedAt: candidate.updatedAt ?? null,
          },
  };

  const rendered = candidate
    ? `Resumable task found: ${candidate.id} (${candidate.status}).\n`
    : 'No resumable task found for this session.\n';

  outputCommandResult(payload, rendered, Boolean(options.json));
}

function handleCancel(argv: string[]): void {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ['cwd'],
    booleanOptions: ['json'],
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? '';

  const { workspaceRoot, job } = resolveCancelableJob(cwd, reference, {
    env: process.env,
  });

  const existing = readStoredJob(workspaceRoot, job.id) ?? { id: job.id };

  // The worker or foreground companion ends first, so it cannot overwrite the cancelled state. Then the process group of `agy`.
  const worker = terminateProcessTree(job.pid ?? Number.NaN);
  const agy = terminateProcessTree(job.agyPid ?? existing.agyPid ?? Number.NaN);

  appendLogLine(job.logFile, 'Cancelled by user.');

  const completedAt = nowIso();

  const nextJob: Job = {
    ...job,
    status: 'cancelled',
    phase: 'cancelled',
    pid: null,
    agyPid: null,
    completedAt,
    errorMessage: 'Cancelled by user.',
  };

  writeJobFile(workspaceRoot, job.id, {
    ...existing,
    ...nextJob,
    cancelledAt: completedAt,
  });

  upsertJob(workspaceRoot, {
    id: job.id,
    status: 'cancelled',
    phase: 'cancelled',
    pid: null,
    agyPid: null,
    errorMessage: 'Cancelled by user.',
    completedAt,
  });

  const payload = {
    jobId: job.id,
    status: 'cancelled',
    title: job.title,
    workerTerminated: worker.delivered,
    agyTerminated: agy.delivered,
  };

  outputCommandResult(
    payload,
    renderCancelReport(nextJob),
    Boolean(options.json),
  );
}

async function main(): Promise<void> {
  const [subcommand, ...argv] = process.argv.slice(2);

  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    printUsage();

    return;
  }

  switch (subcommand) {
    case 'setup':
      handleSetup(argv);
      break;
    case 'review':
      await handleReviewCommand(argv, 'Review');
      break;
    case 'adversarial-review':
      await handleReviewCommand(argv, 'Adversarial Review');
      break;
    case 'task':
      await handleTask(argv);
      break;
    case 'task-worker':
      await handleTaskWorker(argv);
      break;
    case 'status':
      await handleStatus(argv);
      break;
    case 'result':
      handleResult(argv);
      break;
    case 'task-resume-candidate':
      handleTaskResumeCandidate(argv);
      break;
    case 'cancel':
      handleCancel(argv);
      break;
    default:
      throw new Error(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);

  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

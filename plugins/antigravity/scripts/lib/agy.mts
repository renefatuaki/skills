// Replaces scripts/lib/codex.mjs of the OpenAI Codex plugin for Claude Code 1.0.6 (Apache-2.0 License, Copyright 2026 OpenAI), which talks to the Codex app server. This file runs one `agy -p ... --output-format json` child process per run instead.
// The read-only guard and the model slug resolution come from skills/workflow/engineering/scripts/antigravity-model.mts of this repository.
// https://antigravity.google/docs/cli/headless.md

import { spawn } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import {
  binaryAvailable,
  runCommand,
  terminateProcessTree,
} from './process.mts';
import type { BinaryStatus, ProgressReporter } from './types.mts';

/** The model names the companion resolves to a slug of `agy models`. */
export const MODEL_NAMES = ['flash', 'pro', 'argon', 'carbon'];

/** The efforts a slug ends in and `--effort` takes, from the lightest to the heaviest. */
export const EFFORT_LADDER = ['low', 'medium', 'high', 'xhigh', 'max'];

/** The effort a model name resolves with when the request names none. */
const DEFAULT_EFFORT = 'high';

/** Ends before the 10-minute cap of a foreground Bash call of Claude Code, with the grace below. */
export const DEFAULT_TIMEOUT_MINUTES = 8;

/** The time the CLI gets to end a run on its own print timeout before the companion kills it. */
const GRACE_MS = 60_000;

/** The time `agy models` and `/usage` get, because both ask the backend. */
const QUERY_TIMEOUT_MS = 30_000;

/** Lets the run write inside the workspace, and run shell commands inside the terminal sandbox. */
const WRITE_FLAGS = [
  '--mode',
  'accept-edits',
  '--sandbox',
  '--settings',
  '{"permissions":{"allow":["command(*)"]}}',
];

export const INSTALL_URL =
  'https://antigravity.google/docs/getting-started?tab=cli';

export const NOT_INSTALLED = `The Antigravity CLI \`agy\` is not installed. Install it from ${INSTALL_URL}, then rerun /antigravity:setup.`;

export const DEFAULT_CONTINUE_PROMPT =
  'Continue from the current conversation state. Pick the next highest-value step and follow through until the task is resolved.';

/** The JSON line `agy --output-format json` prints, the fields the companion reads. */
export type AgyAnswer = {
  conversation_id?: string;
  status?: string;
  response?: string;
  duration_seconds?: number;
  num_turns?: number;
  finished_reason?: string;
  error?: string;
  structured_output?: unknown;
  denied_actions?: { action: string }[];
  command?: { data?: { groups?: UsageGroup[] } };
};

/** A group of `/usage`, such as Gemini Models, whose models share the buckets. */
export type UsageGroup = {
  name: string;
  description?: string;
  buckets?: UsageBucket[];
};

/** A limit of a group, such as the weekly one, with the fraction of it left. */
export type UsageBucket = {
  window?: string;
  remaining_fraction?: number;
  reset_time?: string;
};

/** The models the signed-in account lists, or the reason `agy models` gave none. */
export type ModelList =
  | { ok: true; slugs: string[] }
  | { ok: false; detail: string; missing: boolean };

/** Whether the account is signed in, which `agy models` answers. */
export type AuthStatus = {
  available: boolean;
  loggedIn: boolean;
  detail: string;
  models: string[];
};

/** The usage groups of the account, or the reason `/usage` gave none. */
export type UsageStatus = {
  available: boolean;
  groups: UsageGroup[];
  detail: string;
};

/** The flags that pick the model, and the notes about a choice the companion changed. */
export type ModelSelection = {
  args: string[];
  notes: string[];
  slug: string | null;
};

/** What one run of `agy` asks for. */
export type AgyRunOptions = {
  cwd: string;
  prompt: string;
  model: string | null;
  effort: string | null;
  write: boolean;
  conversationId?: string | null;
  jsonSchema?: string | null;
  timeoutMinutes: number | null;
  phase?: string;
  guardIgnoreDir?: string;
  onSpawn?: (pid: number) => void;
  onProgress?: ProgressReporter | null;
};

/** What one run of `agy` left, with the reason when it counts as failed. */
export type AgyRun = {
  ok: boolean;
  failure: string | null;
  status: string;
  conversationId: string | null;
  response: string;
  structuredOutput: unknown;
  notes: string[];
  stderr: string;
  exitCode: number | null;
  answer: AgyAnswer | null;
  changedFiles: string[];
  command: string[];
};

/** The paths `git status` lists, each with its status code and the size and modification time on disk. */
export type TreeState = {
  root: string;
  files: Map<string, string>;
};

/** What the child process left before the companion judges it. */
type RawRun = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  spawnError: NodeJS.ErrnoException | null;
  timedOut: boolean;
};

/** The exit codes a signal adds to 128. */
const SIGNAL_NUMBERS: Record<string, number> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGTERM: 15,
};

const SLUG_PATTERN = /^[a-z][a-z0-9.]*(?:-[a-z0-9.]+)+$/;

/** Checks that `agy` answers `--version`. */
export function getAgyAvailability(cwd: string): BinaryStatus {
  return binaryAvailable('agy', ['--version'], { cwd });
}

/** Lists the slugs, the first word of each line of `agy models`. A line that is no slug never matches. */
export function listModelSlugs(cwd: string): ModelList {
  const result = runCommand('agy', ['models'], {
    cwd,
    timeout: QUERY_TIMEOUT_MS,
  });

  if (result.error?.code === 'ENOENT') {
    return { ok: false, detail: 'not found', missing: true };
  }

  if (result.error !== null) {
    return { ok: false, detail: result.error.message, missing: false };
  }

  if (result.status !== 0) {
    const detail =
      result.stderr.trim() ||
      result.stdout.trim() ||
      `agy models exited with code ${result.status}`;

    return { ok: false, detail, missing: false };
  }

  const slugs = result.stdout
    .split('\n')
    .map(line => line.trim().split(/\s+/)[0])
    .filter(word => SLUG_PATTERN.test(word));

  if (slugs.length === 0) {
    return {
      ok: false,
      detail: '`agy models` lists no model for this account.',
      missing: false,
    };
  }

  return { ok: true, slugs };
}

/** Tells whether the account is signed in, because `agy models` fails or lists nothing without a sign-in. */
export function getAgyAuthStatus(cwd: string): AuthStatus {
  const availability = getAgyAvailability(cwd);

  if (!availability.available) {
    return {
      available: false,
      loggedIn: false,
      detail: availability.detail,
      models: [],
    };
  }

  const list = listModelSlugs(cwd);

  if (!list.ok) {
    return {
      available: true,
      loggedIn: false,
      detail: `not signed in: ${list.detail}`,
      models: [],
    };
  }

  return {
    available: true,
    loggedIn: true,
    detail: `signed in, ${list.slugs.length} model(s) listed`,
    models: list.slugs,
  };
}

/** Parses the last non-empty line of the output as the JSON answer, or the whole output when that fails. */
export function readAnswer(stdout: string): AgyAnswer | null {
  const lines = stdout.split('\n').filter(line => line.trim() !== '');

  for (const candidate of [lines[lines.length - 1] ?? '', stdout]) {
    try {
      const answer: unknown = JSON.parse(candidate);

      if (typeof answer === 'object' && answer !== null) {
        return answer as AgyAnswer;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/** Asks `agy` for the usage groups of the account, which works in print mode. */
export function readUsage(cwd: string): UsageStatus {
  const result = runCommand(
    'agy',
    ['-p', '/usage', '--output-format', 'json'],
    {
      cwd,
      timeout: QUERY_TIMEOUT_MS,
    },
  );

  if (result.error !== null) {
    const detail =
      result.error.code === 'ENOENT' ? 'not found' : result.error.message;

    return { available: false, groups: [], detail };
  }

  const answer = readAnswer(result.stdout);
  const groups = answer?.command?.data?.groups;

  if (
    result.status !== 0 ||
    answer?.status !== 'SUCCESS' ||
    !Array.isArray(groups)
  ) {
    const detail =
      answer?.error ??
      (result.stderr.trim() ||
        `agy -p /usage exited with code ${result.status} and reported no groups`);

    return { available: false, groups: [], detail };
  }

  return { available: true, groups, detail: 'ok' };
}

function compareVersions(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function distance(a: string, b: string): number {
  return Math.abs(EFFORT_LADDER.indexOf(a) - EFFORT_LADDER.indexOf(b));
}

/** Checks the effort against the ladder, and returns it lower-cased or null when none was given. */
export function normalizeEffort(
  effort: string | null | undefined,
): string | null {
  const normalized = (effort ?? '').trim().toLowerCase();

  if (normalized === '') {
    return null;
  }

  if (!EFFORT_LADDER.includes(normalized)) {
    throw new Error(
      `Unsupported effort "${effort}". Use one of: ${EFFORT_LADDER.join(', ')}.`,
    );
  }

  return normalized;
}

/** Accepts a model name or a full slug, and returns the model lower-cased or null when none was given. */
export function normalizeModel(
  model: string | null | undefined,
): string | null {
  const normalized = (model ?? '').trim();

  if (normalized === '') {
    return null;
  }

  const lowered = normalized.toLowerCase();

  if (MODEL_NAMES.includes(lowered)) {
    return lowered;
  }

  if (lowered.startsWith('gemini-')) {
    return normalized;
  }

  throw new Error(
    `Unsupported model "${model}". Use one of: ${MODEL_NAMES.join(', ')}, or a full slug such as gemini-3.8-flash-high.`,
  );
}

/**
 * Resolves the newest version of the model name to the slug with the effort asked for, or with the nearest effort that version lists.
 * @see {@link https://antigravity.google/docs/cli/headless.md | Headless mode}
 */
function resolveSlug(
  listed: string[],
  modelName: string,
  wanted: string,
): { slug: string; notes: string[] } {
  const slugPattern = new RegExp(
    `^(gemini-(\\d+(?:\\.\\d+)*)-${modelName})-(${EFFORT_LADDER.join('|')})$`,
  );

  const candidates = listed.flatMap(id => {
    const match = slugPattern.exec(id);

    return match === null
      ? []
      : [
          {
            id,
            prefix: match[1],
            version: match[2].split('.').map(Number),
            effort: match[3],
          },
        ];
  });

  if (candidates.length === 0) {
    throw new Error(
      `The Antigravity CLI lists no model named ${modelName}. The account may lack the plan that includes it.`,
    );
  }

  const newest = candidates.reduce((a, b) =>
    compareVersions(b.version, a.version) > 0 ? b : a,
  );

  const nearest = candidates
    .filter(
      candidate => compareVersions(candidate.version, newest.version) === 0,
    )
    .sort(
      (a, b) =>
        distance(a.effort, wanted) - distance(b.effort, wanted) ||
        EFFORT_LADDER.indexOf(a.effort) - EFFORT_LADDER.indexOf(b.effort),
    )[0];

  const notes =
    nearest.effort === wanted
      ? []
      : [
          `Antigravity lists no ${nearest.prefix} with the effort ${wanted}, so it runs ${nearest.id}.`,
        ];

  return { slug: nearest.id, notes };
}

/** Turns --model and --effort into the flags of `agy`. A slug carries its effort, so --effort never travels with one. */
export function resolveModelSelection(
  cwd: string,
  model: string | null,
  effort: string | null,
): ModelSelection {
  if (model === null) {
    return {
      args: effort === null ? [] : ['--effort', effort],
      notes: [],
      slug: null,
    };
  }

  if (model.startsWith('gemini-')) {
    const notes =
      effort === null
        ? []
        : [
            `The slug ${model} carries its effort, so --effort ${effort} is ignored.`,
          ];

    return { args: ['--model', model], notes, slug: model };
  }

  const list = listModelSlugs(cwd);

  if (!list.ok) {
    throw new Error(
      list.missing
        ? NOT_INSTALLED
        : `Could not list the Antigravity models: ${list.detail} Run /antigravity:setup.`,
    );
  }

  const { slug, notes } = resolveSlug(
    list.slugs,
    model,
    effort ?? DEFAULT_EFFORT,
  );

  return { args: ['--model', slug], notes, slug };
}

/** Builds the arguments of one `agy` run, read-only unless the request asks to write. */
export function buildAgyArgs(
  options: AgyRunOptions,
  selection: ModelSelection,
): string[] {
  const args = ['-p', options.prompt, '--output-format', 'json'];

  args.push(...selection.args);

  if (options.conversationId) {
    args.push('--conversation', options.conversationId);
  }

  if (options.jsonSchema) {
    args.push('--json-schema', options.jsonSchema);
  }

  if (options.write) {
    args.push(...WRITE_FLAGS);
  }

  if (options.timeoutMinutes !== null) {
    args.push('--print-timeout', `${options.timeoutMinutes}m`);
  }

  return args;
}

/** Records the status, size and modification time of every path `git status` lists in the work tree of the folder, or nothing outside a work tree. */
export function snapshotWorkTree(cwd: string): TreeState | undefined {
  const top = runCommand('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    shell: false,
  });

  if (top.error !== null || top.status !== 0) {
    return undefined;
  }

  const root = top.stdout.trim();

  const status = runCommand(
    'git',
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    { cwd: root, maxBuffer: 64 * 1024 * 1024, shell: false },
  );

  if (status.error !== null || status.status !== 0) {
    return undefined;
  }

  return {
    root,
    files: new Map(
      listChanges(status.stdout).map(({ code, path }) => [
        path,
        `${code} ${fingerprint(join(root, path))}`,
      ]),
    ),
  };
}

/**
 * Splits the NUL-separated output of `git status --porcelain=v1 -z` into status codes and paths.
 * @see {@link https://git-scm.com/docs/git-status#_porcelain_format_version_1 | Porcelain format version 1}
 */
function listChanges(status: string): { code: string; path: string }[] {
  const entries = status.split('\0').filter(entry => entry !== '');
  const changes: { code: string; path: string }[] = [];

  for (let index = 0; index < entries.length; index++) {
    const code = entries[index].slice(0, 2);

    changes.push({ code, path: entries[index].slice(3) });

    // A rename or a copy names its origin in the next entry.
    if (/[RC]/.test(code)) {
      index++;
    }
  }

  return changes;
}

/** Reads the size and the modification time of a path, or `gone` for a path that is deleted. */
function fingerprint(path: string): string {
  try {
    const stats = lstatSync(path);

    return `${stats.size}:${stats.mtimeMs}`;
  } catch {
    return 'gone';
  }
}

/** Resolves symbolic links of a folder, because Git reports the real path of the work tree. */
function realPath(folder: string | undefined): string | undefined {
  try {
    return folder === undefined ? undefined : realpathSync.native(folder);
  } catch {
    return folder;
  }
}

/** Lists the paths of the work tree that differ from the state before the run, which catches a write that the permission mode allowed. */
export function changedPaths(
  before: TreeState,
  after: TreeState,
  ignoreDir?: string,
): string[] {
  return [...new Set([...before.files.keys(), ...after.files.keys()])]
    .filter(path => before.files.get(path) !== after.files.get(path))
    .filter(
      path =>
        ignoreDir === undefined ||
        !join(before.root, path).startsWith(ignoreDir),
    )
    .sort();
}

/** Picks the lines of stderr that explain a failure, the `AGY_ERROR` line first, else the last few lines. */
function actionableLines(stderr: string): string[] {
  const lines = stderr
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('jetski:'));

  const agyError = lines.filter(line => line.startsWith('AGY_ERROR'));

  if (agyError.length > 0) {
    return agyError;
  }

  const likely = lines.filter(line =>
    /error|fail|denied|permission|quota|unauthor|sign.?in|timed? ?out|exceed/i.test(
      line,
    ),
  );

  return (likely.length > 0 ? likely : lines).slice(-5);
}

/** Collects the `jetski: ...` notices, which name the permission a soft-denied tool needed. */
function jetskiNotes(stderr: string): string[] {
  return stderr
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('jetski:'));
}

function describeFailure(
  headline: string,
  answer: AgyAnswer | null,
  stderr: string,
): string {
  const lines = [headline];

  if (answer?.error) {
    lines.push(`Error: ${answer.error}`);
  }

  for (const line of actionableLines(stderr)) {
    if (!lines.some(existing => existing.includes(line))) {
      lines.push(line);
    }
  }

  return lines.join('\n');
}

function deniedNotes(answer: AgyAnswer | null): string[] {
  const actions = new Set((answer?.denied_actions ?? []).map(d => d.action));

  return actions.size === 0
    ? []
    : [`The permission mode denied: ${[...actions].join(', ')}.`];
}

/** Judges what the child left: a failure reason for every way a run can end badly, else the response. */
export function analyzeRun(
  raw: RawRun,
  expectStructured: boolean,
): Omit<AgyRun, 'changedFiles' | 'command'> {
  const answer = readAnswer(raw.stdout);
  const jetski = jetskiNotes(raw.stderr);
  const notes = jetski.length > 0 ? jetski : deniedNotes(answer);
  const status = answer?.status ?? 'NONE';
  const response = (answer?.response ?? '').trimEnd();
  const structuredOutput = answer?.structured_output ?? null;

  const base = {
    status,
    conversationId: answer?.conversation_id || null,
    response,
    structuredOutput,
    notes,
    stderr: raw.stderr.trim(),
    exitCode: raw.exitCode,
    answer,
  };

  const failed = (headline: string) => ({
    ...base,
    ok: false,
    failure: describeFailure(headline, answer, raw.stderr),
  });

  if (raw.spawnError !== null) {
    return {
      ...base,
      ok: false,
      failure:
        raw.spawnError.code === 'ENOENT'
          ? NOT_INSTALLED
          : `Antigravity could not start: ${raw.spawnError.message}`,
    };
  }

  if (raw.timedOut) {
    return failed(
      'Antigravity did not end within its time limit and was stopped.',
    );
  }

  if (answer === null) {
    return failed(
      `Antigravity exited with code ${raw.exitCode} and printed no JSON answer.`,
    );
  }

  if (answer.status !== 'SUCCESS' || raw.exitCode !== 0) {
    return failed(
      `Antigravity failed with status ${answer.status ?? 'none'} and exit code ${raw.exitCode}.`,
    );
  }

  if (answer.finished_reason) {
    return failed(`Antigravity stopped early with ${answer.finished_reason}.`);
  }

  if (response === '' && !(expectStructured && structuredOutput !== null)) {
    return failed('Antigravity answered nothing.');
  }

  return { ...base, ok: true, failure: null };
}

/** Shows the command line of a run for the log, with the prompt cut to its length. */
function describeCommand(args: string[]): string {
  const shown = args.map((arg, index) =>
    index === 1 ? `<prompt, ${arg.length} chars>` : arg,
  );

  return ['agy', ...shown]
    .map(arg => (/[\s{}"]/.test(arg) ? `'${arg}'` : arg))
    .join(' ');
}

/** Stops the process group of a child that is still running, with a kill after a short wait for one that ignores the term. */
function stopGroup(pid: number): void {
  terminateProcessTree(pid);
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // The group already ended.
    }
  }, 5000).unref();
}

/** Runs the child to its end and collects its streams. The child leads its own process group, so cancel can stop it and its tools. */
function spawnAgy(args: string[], options: AgyRunOptions): Promise<RawRun> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const child = spawn('agy', args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      windowsHide: true,
    });

    const finish = (raw: Partial<RawRun>) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      process.off('SIGTERM', onSignal);
      process.off('SIGINT', onSignal);
      process.off('SIGHUP', onSignal);
      resolve({
        stdout,
        stderr,
        exitCode: null,
        spawnError: null,
        timedOut,
        ...raw,
      });
    };

    const onSignal = (signal: NodeJS.Signals) => {
      if (child.pid !== undefined) {
        terminateProcessTree(child.pid);
      }

      process.exit(128 + SIGNAL_NUMBERS[signal]);
    };

    timer =
      options.timeoutMinutes === null
        ? undefined
        : setTimeout(
            () => {
              timedOut = true;

              if (child.pid !== undefined) {
                stopGroup(child.pid);
              }
            },
            options.timeoutMinutes * 60_000 + GRACE_MS,
          );

    process.on('SIGTERM', onSignal);
    process.on('SIGINT', onSignal);
    process.on('SIGHUP', onSignal);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.on('error', error =>
      finish({ spawnError: error as NodeJS.ErrnoException }),
    );

    child.on('close', code => finish({ exitCode: code }));

    if (child.pid !== undefined) {
      options.onSpawn?.(child.pid);
    }
  });
}

/**
 * Runs one `agy` turn and judges it. A run without --write also fails when it changed a file of the work tree.
 * @see {@link https://antigravity.google/docs/cli/modes.md | Modes}
 */
export async function runAgy(options: AgyRunOptions): Promise<AgyRun> {
  const selection = resolveModelSelection(
    options.cwd,
    options.model,
    options.effort,
  );

  for (const note of selection.notes) {
    process.stderr.write(`${note}\n`);
    options.onProgress?.({ message: note, stderrMessage: '' });
  }

  const args = buildAgyArgs(options, selection);

  const before = options.write ? undefined : snapshotWorkTree(options.cwd);

  options.onProgress?.({
    message: `Command: ${describeCommand(args)}`,
    stderrMessage: '',
  });

  options.onProgress?.({
    message: `Running agy${selection.slug ? ` with ${selection.slug}` : ''}, ${options.write ? 'write-capable' : 'read-only'}.`,
    phase: options.phase ?? 'running',
  });

  const raw = await spawnAgy(args, options);

  const analysis = analyzeRun(raw, Boolean(options.jsonSchema));
  const after =
    before === undefined ? undefined : snapshotWorkTree(options.cwd);

  const changedFiles =
    before === undefined || after === undefined
      ? []
      : changedPaths(before, after, realPath(options.guardIgnoreDir));

  const failure = [
    analysis.failure,
    changedFiles.length > 0
      ? `Antigravity changed files: ${changedFiles.join(', ')}`
      : null,
  ]
    .filter(line => line !== null)
    .join('\n');

  options.onProgress?.({
    message: `Antigravity ended with ${analysis.status}.`,
    phase: 'finalizing',
    conversationId: analysis.conversationId ?? undefined,
  });

  return {
    ...analysis,
    ok: failure === '',
    failure: failure === '' ? null : failure,
    changedFiles,
    command: ['agy', ...args],
  };
}

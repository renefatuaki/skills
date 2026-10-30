#!/usr/bin/env node

// Prints the newest Gemini id the Antigravity CLI lists for a model name and an effort, with `--effort` after an id that does not carry the effort, or with --run sends the brief on stdin to that model and prints its answer.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

/** The line `agy --output-format json` prints for a run, the fields this script reads. */
type Answer = {
  status?: string;
  response?: string;
  error?: string;
  finished_reason?: string;
  denied_actions?: { action: string }[];
};

/** A listed model whose id matches, with the version its id carries and whether the id ends in the effort. */
type Candidate = {
  id: string;
  version: number[];
  carriesEffort: boolean;
};

/** The id to run and the effort to pass as `--effort`, null when the id ends in the effort, which fails on any other `--effort`. */
type Model = {
  id: string;
  effort: string | null;
};

const NAMES = ['flash', 'pro', 'argon', 'carbon'];

const EFFORTS = ['high', 'medium', 'low'];

const USAGE = `usage: antigravity.mts [--run [--timeout <minutes>]] <${NAMES.join('|')}> <${EFFORTS.join('|')}>`;

/** Ends before the 10-minute cap of a foreground Bash call of Claude Code, with the grace below. */
const DEFAULT_TIMEOUT_MINUTES = 8;

/** The time the CLI gets to end a run on its own print timeout before this script kills it. */
const GRACE_MS = 60_000;

const NOT_INSTALLED = 'The Antigravity CLI `agy` is not installed.';

// 1. Read the mode, the model name, the effort and the timeout from the command line.
// https://nodejs.org/api/util.md#utilparseargsconfig
const { values, positionals } = readArgs();

const [name, effort] = positionals;

const isRun = values.run === true;

if (
  positionals.length !== 2 ||
  !NAMES.includes(name) ||
  !EFFORTS.includes(effort) ||
  !isMinutes(values.timeout) ||
  (!isRun && values.timeout !== undefined)
) {
  fail(USAGE);
}

const minutes =
  values.timeout === undefined
    ? DEFAULT_TIMEOUT_MINUTES
    : Number(values.timeout);

// 2. Resolve the newest id the CLI lists for the name and the effort.
const model = newestModel(listModels(), name, effort);

// 3. Print the model, or send the brief to it and print its answer.
if (!isRun) {
  console.log(describe(model));
  process.exit(0);
}

console.log(responseOf(runAgy(model, readBrief(), minutes)));

/** Writes the id, followed by `--effort` and the effort when the id does not end in it. */
function describe(resolved: Model): string {
  return resolved.effort === null
    ? resolved.id
    : `${resolved.id} --effort ${resolved.effort}`;
}

/** Parses the command line, and fails with the usage line on an unknown option. */
function readArgs() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        run: { type: 'boolean' },
        timeout: { type: 'string' },
      },
    });
  } catch {
    fail(USAGE);
  }
}

/** Accepts a missing option or a whole number of minutes above 0. */
function isMinutes(value: string | undefined): boolean {
  return value === undefined || /^[1-9]\d*$/.test(value);
}

/** Lists the ids `agy models` prints, the text before the tab of each line. */
function listModels(): string[] {
  const result = spawnSync('agy', ['models'], { encoding: 'utf8' });

  if (result.error !== undefined) {
    fail(isMissing(result.error) ? NOT_INSTALLED : result.error.message);
  }

  if (result.status !== 0) {
    fail(
      `\`agy models\` exited with code ${result.status}. Sign in with \`agy\` and try again.${detail(result.stderr)}`,
    );
  }

  return result.stdout.split('\n').map(line => line.split('\t')[0].trim());
}

/** Returns the newest listed model of the name by version, and at one version the id that ends in the effort. */
function newestModel(
  listed: string[],
  modelName: string,
  level: string,
): Model {
  const idPattern = new RegExp(
    `^gemini-(\\d+(?:\\.\\d+)*)-${modelName}(-${level})?$`,
  );

  const candidates: Candidate[] = listed.flatMap(listedId => {
    const match = idPattern.exec(listedId);

    return match === null
      ? []
      : [
          {
            id: listedId,
            version: match[1].split('.').map(Number),
            carriesEffort: match[2] !== undefined,
          },
        ];
  });

  if (candidates.length === 0) {
    fail(
      `The Antigravity CLI lists no model named ${modelName} with the effort ${level}. The account may lack the tier that includes it.`,
    );
  }

  candidates.sort(
    (a, b) =>
      compareVersions(b.version, a.version) ||
      Number(b.carriesEffort) - Number(a.carriesEffort),
  );

  const [newest] = candidates;

  return { id: newest.id, effort: newest.carriesEffort ? null : level };
}

/** Orders two versions part by part, so 3.10 comes after 3.8 and 4 after 3.10. */
function compareVersions(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function readBrief(): string {
  const brief = readFileSync(0, 'utf8');

  if (brief.trim() === '') {
    fail('The brief on stdin is empty.');
  }

  return brief;
}

/** Runs the brief through `agy` in the current directory. Print mode denies a write, so the run stays read-only. */
function runAgy(model: Model, brief: string, limit: number) {
  const result = spawnSync(
    'agy',
    [
      '-p',
      brief,
      '--output-format',
      'json',
      '--model',
      model.id,
      '--print-timeout',
      `${limit}m`,
      ...(model.effort === null ? [] : ['--effort', model.effort]),
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: limit * 60_000 + GRACE_MS,
    },
  );

  if (result.error !== undefined) {
    fail(isMissing(result.error) ? NOT_INSTALLED : result.error.message);
  }

  return result;
}

/** Returns the response of a run that ended in SUCCESS with an answer, and fails on every other end. */
function responseOf(result: SpawnSyncReturns<string>): string {
  const answer = readAnswer(result.stdout);

  if (answer === undefined) {
    fail(
      `Antigravity exited with code ${result.status} and printed no JSON answer.${detail(result.stderr)}`,
    );
  }

  if (answer.status !== 'SUCCESS' || result.status !== 0) {
    fail(
      `Antigravity failed with status ${answer.status} and exit code ${result.status}.${detail(answer.error ?? result.stderr)}`,
    );
  }

  if (answer.finished_reason !== undefined) {
    fail(`Antigravity stopped early with ${answer.finished_reason}.`);
  }

  const response = (answer.response ?? '').trimEnd();
  const note = deniedNote(answer);

  if (response === '') {
    fail(`Antigravity answered nothing.${detail(note)}`);
  }

  if (note !== '') {
    console.error(note);
  }

  return response;
}

/** Reads the last line of stdout as the answer, undefined when it is no JSON object. */
function readAnswer(stdout: string): Answer | undefined {
  const lines = stdout.split('\n').filter(line => line.trim() !== '');

  try {
    const answer: unknown = JSON.parse(lines[lines.length - 1] ?? '');

    return typeof answer === 'object' && answer !== null
      ? (answer as Answer)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Names each action print mode denied, such as `write_file`, or returns nothing when it denied none. */
function deniedNote(answer: Answer): string {
  const actions = new Set((answer.denied_actions ?? []).map(d => d.action));

  return actions.size === 0
    ? ''
    : `Antigravity tried ${[...actions].join(', ')}, which the read-only run denies.`;
}

function isMissing(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** Appends a message of the CLI to a failure, or nothing when it said none. */
function detail(message: string | undefined): string {
  const trimmed = (message ?? '').trim();

  return trimmed === '' ? '' : ` ${trimmed}`;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

#!/usr/bin/env node

// Prints the newest full name the Codex app-server lists for a model name once the account has enough usage left, or with --usage the usage left as one JSON line, asked over JSON-RPC on stdio.
// https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

/** A model of the `model/list` response, the fields this script reads. */
type Model = {
  model: string;
  hidden: boolean;
};

/** A usage window of the account, such as the 5-hour or the weekly one. */
type UsageWindow = {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
};

/** The `account/rateLimits/read` response, the fields this script reads. */
type Usage = {
  ordinaryUsageAllowed: boolean | null;
  rateLimits: {
    primary: UsageWindow | null;
    secondary: UsageWindow | null;
    credits: { hasCredits: boolean; unlimited: boolean } | null;
    spendControlReached: boolean | null;
    rateLimitReachedType: string | null;
  };
};

/** The line --usage prints, the whole percents left of each window and whether either has less left than the minimum. */
type UsageReport = {
  primary: number | null;
  secondary: number | null;
  belowMinimum: boolean;
};

/** A line the app-server writes, a response that carries the id of its request or a notification that carries none. */
type Message = {
  id?: number;
  method?: string;
  result?: { data: Model[]; nextCursor?: string | null } & Usage;
  error?: { code: number; message: string };
};

/** A listed model whose name matches, with the version its full name carries. */
type Candidate = {
  fullName: string;
  version: number[];
};

const NAMES = ['luna', 'sol', 'astra'];

const USAGE = `usage: codex-model.mts [--min-remaining <percent>] (--usage | <${NAMES.join('|')}>)`;

const TIMEOUT_MS = 30_000;

const INITIALIZE_ID = 0;

const USAGE_ID = 1;

/** Stands in for a missing `codex minimum` line, as model-roles.md says. */
const DEFAULT_MIN_REMAINING = 20;

/** Matches the line /setup-models writes into ~/.claude/rules/models.md, such as `codex minimum: 20%`. */
const MINIMUM_LINE = /^codex minimum:\s*(\d+)\s*%\s*$/m;

// 1. Read the mode, the name and the usage a run needs left from the command line, the minimum from the rule file when the line names none.
// https://nodejs.org/api/util.md#utilparseargsconfig
const { values, positionals } = readArgs();

const [name] = positionals;

const isUsage = values.usage === true;

if (
  (isUsage ? positionals.length !== 0 : positionals.length !== 1) ||
  (!isUsage && !NAMES.includes(name)) ||
  !isPercent(values['min-remaining'])
) {
  fail(USAGE);
}

const minRemaining =
  values['min-remaining'] === undefined
    ? ruleMinimum()
    : Number(values['min-remaining']);

// 2. Start the app-server. It logs a failed refresh of the catalog to stderr and then answers from the catalog bundled with the CLI.
const server = spawn('codex', ['app-server'], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

process.on('exit', () => server.kill());

server.on('error', () => {
  fail('The Codex CLI `codex` is not installed. Run /codex:setup.');
});

server.on('close', (code, signal) => {
  const reason = code === null ? `signal ${signal}` : `code ${code}`;

  fail(`The Codex app-server exited with ${reason} before it answered.`);
});

server.stdin.on('error', () => {
  // The close handler reports the app-server that went away.
});

setTimeout(() => {
  fail(`The Codex app-server did not answer within ${TIMEOUT_MS / 1000} s.`);
}, TIMEOUT_MS).unref();

// 3. Initialize the connection and read the usage. --usage prints it and ends, a name checks it and pages through `model/list`.
const models: Model[] = [];
let nextId = USAGE_ID + 1;

createInterface({ input: server.stdout }).on('line', line => {
  const message = parse(line);

  if (message.id === USAGE_ID) {
    answerUsage(message.result);

    return;
  }

  if (message.error !== undefined) {
    fail(`The Codex app-server refused: ${message.error.message}`);
  }

  if (message.id === INITIALIZE_ID) {
    send({ method: 'initialized' });
    send({ method: 'account/rateLimits/read', id: USAGE_ID });

    return;
  }

  if (message.result === undefined) {
    return;
  }

  models.push(...message.result.data);

  const cursor = message.result.nextCursor ?? null;

  if (cursor !== null) {
    requestModels(cursor);

    return;
  }

  console.log(newestModel(models, name));
  process.exit(0);
});

send({
  method: 'initialize',
  id: INITIALIZE_ID,
  params: { clientInfo: { name: 'forge', version: '0.0.0' } },
});

/** Parses the command line, and fails with the usage line on an unknown option. */
function readArgs() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        'min-remaining': { type: 'string' },
        usage: { type: 'boolean' },
      },
    });
  } catch {
    fail(USAGE);
  }
}

/** Reads one line of the app-server as a message. */
function parse(line: string): Message {
  try {
    return JSON.parse(line) as Message;
  } catch {
    fail(`The Codex app-server wrote a line that is no JSON: ${line}`);
  }
}

/** Accepts a missing option or a whole number of at most 100. */
function isPercent(value: string | undefined): boolean {
  return value === undefined || (/^\d+$/.test(value) && Number(value) <= 100);
}

/** Reads the percent of the `codex minimum` line of the user's rules, 20 without the file, the line or a percent of at most 100. */
function ruleMinimum(): number {
  let rules = '';

  try {
    rules = readFileSync(
      join(homedir(), '.claude', 'rules', 'models.md'),
      'utf8',
    );
  } catch {
    return DEFAULT_MIN_REMAINING;
  }

  const match = MINIMUM_LINE.exec(rules);

  if (match === null) {
    return DEFAULT_MIN_REMAINING;
  }

  const percent = Number(match[1]);

  return percent <= 100 ? percent : DEFAULT_MIN_REMAINING;
}

/** Prints the usage for --usage, else fails a run the usage cannot carry and asks for the models. */
function answerUsage(usage: Usage | undefined): void {
  // An account without usage limits, such as one signed in with an API key, answers with an error.
  if (isUsage) {
    if (usage === undefined) {
      fail('Codex reports no usage limits for this account.');
    }

    console.log(JSON.stringify(report(usage)));
    process.exit(0);
  }

  if (usage !== undefined) {
    checkUsage(usage);
  }

  requestModels(null);
}

/** Reports the whole percents left, rounded down, and whether either window is below the minimum, whatever credits or a reached limit say. */
function report(usage: Usage): UsageReport {
  const { primary, secondary } = usage.rateLimits;

  return {
    primary: remaining(primary),
    secondary: remaining(secondary),
    belowMinimum: [primary, secondary].some(
      window => window !== null && 100 - window.usedPercent < minRemaining,
    ),
  };
}

function remaining(window: UsageWindow | null): number | null {
  return window === null
    ? null
    : Math.max(0, Math.floor(100 - window.usedPercent));
}

/**
 * Asks for the page of models that starts at the cursor, the first page for null.
 * @see {@link https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md | Codex app-server}
 */
function requestModels(cursor: string | null): void {
  send({
    method: 'model/list',
    id: nextId++,
    params: { cursor, includeHidden: false },
  });
}

/**
 * Writes one JSON-RPC message as a line to the app-server.
 * @see {@link https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md | Codex app-server}
 */
function send(message: object): void {
  server.stdin.write(`${JSON.stringify(message)}\n`);
}

/**
 * Fails when the account reached its usage limit or has less than the minimum left of a window, unless credits pay for the run.
 * @see {@link https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md | Codex app-server}
 */
function checkUsage(usage: Usage): void {
  const { credits, spendControlReached, rateLimitReachedType } =
    usage.rateLimits;

  if (
    credits?.unlimited === true ||
    (credits?.hasCredits === true && spendControlReached !== true)
  ) {
    return;
  }

  const windows = [usage.rateLimits.primary, usage.rateLimits.secondary]
    .filter(window => window !== null)
    .sort((a, b) => b.usedPercent - a.usedPercent);

  const [tightest] = windows;

  if (
    usage.ordinaryUsageAllowed === false ||
    spendControlReached === true ||
    rateLimitReachedType !== null
  ) {
    fail(`Codex reached its usage limit.${resetsAt(tightest)}`);
  }

  const left = 100 - (tightest?.usedPercent ?? 0);

  if (left < minRemaining) {
    fail(
      `Codex has ${left} % left of its ${windowName(tightest)} usage window, below the minimum of ${minRemaining} %.${resetsAt(tightest)}`,
    );
  }
}

/** Names a window by its length, such as 5-hour or 7-day. */
function windowName(window: UsageWindow | undefined): string {
  const minutes = window?.windowDurationMins ?? null;

  if (minutes === null) {
    return 'current';
  }

  return minutes < 1440 ? `${minutes / 60}-hour` : `${minutes / 1440}-day`;
}

/** Says when the window resets, or nothing when the server leaves it open. */
function resetsAt(window: UsageWindow | undefined): string {
  const seconds = window?.resetsAt ?? null;

  return seconds === null
    ? ''
    : ` It resets at ${new Date(seconds * 1000).toLocaleString()}.`;
}

/** Returns the full name of the newest model under the name, skipping a hidden model the server still sent. */
function newestModel(listed: Model[], modelName: string): string {
  const fullNamePattern = new RegExp(`^gpt-(\\d+(?:\\.\\d+)*)-${modelName}$`);

  const candidates: Candidate[] = listed.flatMap(model => {
    const match = fullNamePattern.exec(model.model);

    if (model.hidden || match === null) {
      return [];
    }

    return [
      { fullName: model.model, version: match[1].split('.').map(Number) },
    ];
  });

  if (candidates.length === 0) {
    fail(`The Codex CLI lists no model named ${modelName}.`);
  }

  candidates.sort((a, b) => compareVersions(b.version, a.version));

  return candidates[0].fullName;
}

/** Orders two versions part by part, so 6.1 comes after 6 and 6 after 5.6. */
function compareVersions(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

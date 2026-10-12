#!/usr/bin/env node

// Prints the newest full name the Codex app-server lists for a model name, such as gpt-6-astra for astra, once the account has enough usage left, asked over JSON-RPC on stdio.
// https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md

import { spawn } from 'node:child_process';
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

const USAGE = `usage: codex-model.mts [--min-remaining <percent>] <${NAMES.join('|')}>`;

const TIMEOUT_MS = 30_000;

const INITIALIZE_ID = 0;

const USAGE_ID = 1;

const DEFAULT_MIN_REMAINING = '20';

// 1. Read the name and the usage a run needs left, in percent of a window, from the command line.
// https://nodejs.org/api/util.md#utilparseargsconfig
const { values, positionals } = readArgs();

const [name] = positionals;

const minRemaining = Number(values['min-remaining']);

if (
  positionals.length !== 1 ||
  !NAMES.includes(name) ||
  !/^\d+$/.test(values['min-remaining']) ||
  minRemaining > 100
) {
  fail(USAGE);
}

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

  fail(
    `The Codex app-server exited with ${reason} before it listed the models.`,
  );
});

server.stdin.on('error', () => {
  // The close handler reports the app-server that went away.
});

setTimeout(() => {
  fail(`The Codex app-server did not answer within ${TIMEOUT_MS / 1000} s.`);
}, TIMEOUT_MS).unref();

// 3. Initialize the connection, check the usage left, then page through `model/list` without the models hidden from the picker.
const models: Model[] = [];
let nextId = USAGE_ID + 1;

createInterface({ input: server.stdout }).on('line', line => {
  const message = parse(line);

  if (message.id === USAGE_ID) {
    // An account without usage limits, such as one signed in with an API key, answers with an error and runs.
    if (message.result !== undefined) {
      checkUsage(message.result);
    }

    requestModels(null);

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
        'min-remaining': { type: 'string', default: DEFAULT_MIN_REMAINING },
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

  const remaining = 100 - (tightest?.usedPercent ?? 0);

  if (remaining < minRemaining) {
    fail(
      `Codex has ${remaining} % left of its ${windowName(tightest)} usage window, below the minimum of ${minRemaining} %.${resetsAt(tightest)}`,
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

#!/usr/bin/env node

// Prints the slug the Antigravity CLI lists for a model name and an effort once the account has enough usage left, or with --usage the usage left as one JSON line.
// https://antigravity.google/docs/cli/headless.md

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

/** The line `agy -p /usage --output-format json` prints, the fields this script reads. */
type Answer = {
  status?: string;
  error?: string;
  command?: { data?: { groups?: UsageGroup[] } };
};

/** A group of `/usage`, such as Gemini Models, whose models share the buckets. */
type UsageGroup = {
  name: string;
  description?: string;
  buckets?: UsageBucket[];
};

/** A limit of a group, such as the weekly one, with the fraction of it left. */
type UsageBucket = {
  window?: string;
  remaining_fraction?: number;
  reset_time?: string;
};

/** The groups `/usage` reports, or the reason it reported none. */
type UsageRead = { groups: UsageGroup[] } | { problem: string };

/** A bucket with the whole percent left, tightest first when sorted by percent. */
type Limit = {
  group: string;
  window: string;
  percent: number;
  resetTime: string | null;
};

/** The line --usage prints, the whole percent left of each Gemini group and whether any has less left than the minimum. */
type UsageReport = {
  groups: Record<string, number>;
  belowMinimum: boolean;
};

/** A listed slug of the model, with the id before its effort, the version that id carries and the effort it ends in. */
type Candidate = {
  id: string;
  prefix: string;
  version: number[];
  effort: string;
};

const NAMES = ['flash', 'pro', 'argon', 'carbon'];

/** The efforts a slug ends in, from the lightest to the heaviest. */
const LADDER = ['low', 'medium', 'high', 'xhigh', 'max'];

const USAGE = `usage: antigravity-model.mts [--min-remaining <percent>] <${NAMES.join('|')}> <${[...LADDER].reverse().join('|')}>
       antigravity-model.mts --usage [--min-remaining <percent>]`;

/** The time `/usage` gets, because it asks the backend. */
const USAGE_TIMEOUT_MS = 30_000;

/** Stands in for a missing `antigravity minimum` line, as model-roles.md says. */
const DEFAULT_MIN_REMAINING = 20;

/** Matches the line /setup-models writes into ~/.claude/rules/models.md, such as `antigravity minimum: 20%`. */
const MINIMUM_LINE = /^antigravity minimum:\s*(\d+)\s*%\s*$/m;

const NOT_INSTALLED = 'The Antigravity CLI `agy` is not installed.';

// 1. Read the mode, the model name, the effort and the usage a run needs left from the command line, the minimum from the rule file when the line names none.
// https://nodejs.org/api/util.md#utilparseargsconfig
const { values, positionals } = readArgs();

const [name, effort] = positionals;

const isUsage = values.usage === true;

if (
  (isUsage
    ? positionals.length !== 0
    : positionals.length !== 2 ||
      !NAMES.includes(name) ||
      !LADDER.includes(effort)) ||
  !isPercent(values['min-remaining'])
) {
  fail(USAGE);
}

const minRemaining =
  values['min-remaining'] === undefined
    ? ruleMinimum()
    : Number(values['min-remaining']);

// 2. Print the usage left of the Gemini groups and end.
if (isUsage) {
  console.log(JSON.stringify(usageReport()));
  process.exit(0);
}

// 3. Resolve the slug the CLI lists for the name and the effort, and print it once the usage allows a run.
const slug = resolveSlug(listModels(), name, effort);

checkUsage(name);

console.log(slug);

/** Parses the command line, and fails with the usage line on an unknown option. */
function readArgs() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        usage: { type: 'boolean' },
        'min-remaining': { type: 'string' },
      },
    });
  } catch {
    fail(USAGE);
  }
}

/** Accepts a missing option or a whole number of at most 100. */
function isPercent(value: string | undefined): boolean {
  return value === undefined || (/^\d+$/.test(value) && Number(value) <= 100);
}

/** Reads the percent of the `antigravity minimum` line of the user's rules, 20 without the file, the line or a percent of at most 100. */
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

/** Lists the first word of each line `agy models` prints. A line that is no slug, such as the progress line, never matches a model. */
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

  return result.stdout.split('\n').map(line => line.trim().split(/\s+/)[0]);
}

/**
 * Returns the slug of the newest version of the model, with the effort asked for or the nearest effort that version lists, and notes the difference on stderr.
 * @see {@link https://antigravity.google/docs/cli/headless.md | Headless mode}
 */
function resolveSlug(
  listed: string[],
  modelName: string,
  wanted: string,
): string {
  const slugPattern = new RegExp(
    `^(gemini-(\\d+(?:\\.\\d+)*)-${modelName})-(${LADDER.join('|')})$`,
  );

  const candidates: Candidate[] = listed.flatMap(listedId => {
    const match = slugPattern.exec(listedId);

    return match === null
      ? []
      : [
          {
            id: listedId,
            prefix: match[1],
            version: match[2].split('.').map(Number),
            effort: match[3],
          },
        ];
  });

  if (candidates.length === 0) {
    fail(
      `The Antigravity CLI lists no model named ${modelName}. The account may lack the tier that includes it.`,
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
        LADDER.indexOf(a.effort) - LADDER.indexOf(b.effort),
    )[0];

  if (nearest.effort !== wanted) {
    console.error(
      `Antigravity lists no ${nearest.prefix} with the effort ${wanted}, so it runs ${nearest.id}.`,
    );
  }

  return nearest.id;
}

/** Counts the steps between two efforts on the ladder. */
function distance(a: string, b: string): number {
  return Math.abs(LADDER.indexOf(a) - LADDER.indexOf(b));
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

/**
 * Asks `agy` for the usage groups of the account, which works in print mode.
 * @see {@link https://antigravity.google/docs/cli/commands/usage.md | Model quotas}
 */
function readUsage(): UsageRead {
  const result = spawnSync('agy', ['-p', '/usage', '--output-format', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: USAGE_TIMEOUT_MS,
  });

  if (result.error !== undefined) {
    return {
      problem: isMissing(result.error) ? NOT_INSTALLED : result.error.message,
    };
  }

  const answer = readAnswer(result.stdout);
  const groups = answer?.command?.data?.groups;

  if (
    result.status !== 0 ||
    answer?.status !== 'SUCCESS' ||
    !Array.isArray(groups)
  ) {
    return {
      problem: `\`agy -p /usage\` exited with code ${result.status} and reported no groups.${detail(answer?.error ?? result.stderr)}`,
    };
  }

  return { groups };
}

/** Picks the groups whose models share the usage of the model name, the group that lists `Gemini <Model>` in its description, else every group whose name starts with Gemini. */
function groupsOf(groups: UsageGroup[], modelName: string): UsageGroup[] {
  const listing = groups.filter(group => lists(group, [modelName]));

  return listing.length > 0 ? listing : groups.filter(isGeminiGroup);
}

/** Tells whether the description of a group lists `Gemini <Model>` for one of the models. */
function lists(group: UsageGroup, modelNames: string[]): boolean {
  return modelNames.some(modelName =>
    new RegExp(`\\bGemini\\s+${modelName}\\b`, 'i').test(
      group.description ?? '',
    ),
  );
}

function isGeminiGroup(group: UsageGroup): boolean {
  return /^Gemini/i.test(group.name);
}

/** Turns the buckets of the groups into limits with the whole percent left, the tightest first. */
function limitsOf(groups: UsageGroup[]): Limit[] {
  return groups
    .flatMap(group =>
      (group.buckets ?? []).flatMap(bucket =>
        typeof bucket.remaining_fraction === 'number'
          ? [
              {
                group: group.name,
                window: bucket.window ?? 'current',
                percent: Math.round(bucket.remaining_fraction * 100),
                resetTime: bucket.reset_time ?? null,
              },
            ]
          : [],
      ),
    )
    .sort((a, b) => a.percent - b.percent);
}

/** Fails when the tightest limit of the model has less than the minimum left, and notes on stderr that the slug is printed unchecked when `/usage` reports nothing for it. */
function checkUsage(modelName: string): void {
  const usage = readUsage();

  const [tightest] =
    'problem' in usage ? [] : limitsOf(groupsOf(usage.groups, modelName));

  if (tightest === undefined) {
    console.error(
      `Antigravity reports no Gemini usage, so the run starts without a usage check.${detail('problem' in usage ? usage.problem : undefined)}`,
    );

    return;
  }

  if (tightest.percent < minRemaining) {
    fail(
      `Antigravity has ${tightest.percent} % left of its ${tightest.window} limit for ${tightest.group}, below the minimum of ${minRemaining} %.${resetsAt(tightest)}`,
    );
  }
}

/** Says when the limit resets, or nothing when the CLI leaves it open. */
function resetsAt(limit: Limit): string {
  return limit.resetTime === null ? '' : ` It resets at ${limit.resetTime}.`;
}

/** Reports the tightest whole percent left of each Gemini group, and whether any is below the minimum. */
function usageReport(): UsageReport {
  const usage = readUsage();

  if ('problem' in usage) {
    fail(usage.problem);
  }

  const percents = Object.fromEntries(
    usage.groups
      .filter(group => isGeminiGroup(group) || lists(group, NAMES))
      .flatMap((group): [string, number][] => {
        const [tightest] = limitsOf([group]);

        return tightest === undefined ? [] : [[group.name, tightest.percent]];
      }),
  );

  const left = Object.values(percents);

  if (left.length === 0) {
    fail('Antigravity reports no usage for a Gemini group.');
  }

  return {
    groups: percents,
    belowMinimum: left.some(percent => percent < minRemaining),
  };
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

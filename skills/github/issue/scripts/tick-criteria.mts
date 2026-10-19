#!/usr/bin/env node

// Ticks criteria in the body of an issue, under Acceptance criteria, Done when or Success criteria, and never clears a tick, so the issue shows what is proven done.

import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

/** A criterion of the issue, numbered by its place among the checkboxes of the criteria sections. */
type Criterion = {
  number: number;
  ticked: boolean;
};

/** The body with its checkboxes set, and the criteria found in it. */
type TickedBody = {
  body: string;
  criteria: Criterion[];
};

const USAGE = 'usage: tick-criteria.mts <issue-url> (--criteria 1,3 | --all)';

/** Matches the headings of the issue form fields that hold criteria, as the templates skill names them. */
const CRITERIA_HEADING =
  /^###\s+(Acceptance criteria|Done when|Success criteria)\s*$/i;

/** Matches every heading up to the third level, the next one ends a criteria section. */
const FIELD_HEADING = /^#{1,3}\s/;

/** Matches an unindented checkbox and captures the text around its mark, so nested items leave the numbering alone. */
const CRITERION_CHECKBOX = /^([-*] \[)([ xX])(\])/;

// 1. Read the issue and the criteria to tick from the command line.
// https://nodejs.org/api/util.md#utilparseargsconfig
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    criteria: { type: 'string' },
    all: { type: 'boolean', default: false },
  },
});

const [issue] = positionals;
const requested = new Set(
  (values.criteria ?? '').split(',').filter(Boolean).map(Number),
);

if (
  positionals.length !== 1 ||
  values.all === (values.criteria !== undefined) ||
  [...requested].some(Number.isNaN)
) {
  fail(USAGE);
}

// 2. Read the body of the issue.
// https://cli.github.com/manual/gh_issue_view
const view = gh(['issue', 'view', issue, '--json', 'body']);
const body: string = JSON.parse(view).body;

// 3. Tick the criteria and stop when the body lacks one that was asked for.
const ticked = tickCriteria(
  body,
  number => values.all || requested.has(number),
);

const numbers = new Set(ticked.criteria.map(criterion => criterion.number));
const missing = [...requested].filter(number => !numbers.has(number));

if (ticked.criteria.length === 0) {
  fail(
    'The issue has no checkbox under "### Acceptance criteria", "### Done when" or "### Success criteria".',
  );
}

if (missing.length > 0) {
  fail(`The issue has no criterion ${missing.join(', ')}.`);
}

// 4. Write the body back when a checkbox changed.
// https://cli.github.com/manual/gh_issue_edit
if (ticked.body !== body) {
  gh(['issue', 'edit', issue, '--body-file', '-'], ticked.body);
}

// 5. Print every criterion with its mark.
for (const criterion of ticked.criteria) {
  console.log(`${criterion.number} ${criterion.ticked ? 'ticked' : 'open'}`);
}

/** Ticks every criterion the predicate selects and keeps every tick already set, numbering the criteria in body order. */
function tickCriteria(
  body: string,
  selects: (number: number) => boolean,
): TickedBody {
  const criteria: Criterion[] = [];
  let insideCriteria = false;

  const lines = body.split('\n').map(line => {
    if (FIELD_HEADING.test(line)) {
      insideCriteria = CRITERIA_HEADING.test(line);
    }

    const checkbox = insideCriteria ? CRITERION_CHECKBOX.exec(line) : null;

    if (!checkbox) {
      return line;
    }

    const number = criteria.length + 1;
    const wasTicked = checkbox[2] !== ' ';
    const isTicked = wasTicked || selects(number);

    criteria.push({ number, ticked: isTicked });

    return isTicked && !wasTicked
      ? line.replace(CRITERION_CHECKBOX, '$1x$3')
      : line;
  });

  return { body: lines.join('\n'), criteria };
}

/**
 * Runs gh with the input on stdin and returns its stdout, while its stderr goes straight to the terminal.
 * @see {@link https://nodejs.org/api/child_process.md#child_processexecfilesyncfile-args-options | Node.js, child_process.execFileSync}
 */
function gh(args: string[], input?: string): string {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

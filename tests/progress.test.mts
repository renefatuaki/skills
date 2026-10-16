#!/usr/bin/env node

// Folds the events of each case into the run of the progress band and compares the band's line and the Codex reads it started with the expected ones.

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bandLine,
  INITIAL_RUN,
  parseUsage,
  step,
} from '../hooks/progress/run.mts';
import type { Event, Item } from '../hooks/progress/run.mts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(
  root,
  'skills',
  'workflow',
  'engineering',
  'scripts',
  'codex-model.mts',
);

const fakeCodex = join(root, 'tests', 'fixtures', 'codex', 'bin');

/** The band's line with each part's tone, such as `plain:2/4 · Parse | quiet:<spaces to the right edge>Codex 5h 62%`, and how many reads the events started. */
type Result = {
  line: string | null;
  reads: number;
};

/** The band's width for every case that names none. */
const COLUMNS = 200;

const USAGE = '{"primary":62,"secondary":81,"belowMinimum":false}';

const OPEN: Event = {
  kind: 'todosWritten',
  todos: [
    todo('Read the issue', 'completed'),
    todo('Write the parser', 'in_progress'),
    todo('Test the parser', 'pending'),
    todo('Open the pull request', 'pending'),
  ],
};

const DONE: Event = {
  kind: 'todosWritten',
  todos: [
    todo('Read the issue', 'completed'),
    todo('Write the parser', 'completed'),
  ],
};

const PERSON: Event = { kind: 'personPrompted' };

const CASES: {
  name: string;
  events: Event[];
  columns?: number;
  expected: Result;
}[] = [
  {
    name: 'an open list shows the count and the item in progress, and starts a read',
    events: [OPEN],
    expected: { line: 'plain:1/4 · Write the parser', reads: 1 },
  },
  {
    name: 'no item in progress shows the first pending one',
    events: [
      {
        kind: 'todosWritten',
        todos: [
          todo('Read the issue', 'completed'),
          todo('Write the parser', 'pending'),
        ],
      },
    ],
    expected: { line: 'plain:1/2 · Write the parser', reads: 1 },
  },
  {
    name: 'an empty list shows nothing',
    events: [{ kind: 'todosWritten', todos: [] }],
    expected: { line: null, reads: 0 },
  },
  {
    name: 'a finished list shows done until the person prompts',
    events: [OPEN, DONE],
    expected: { line: 'plain:2/2 done', reads: 1 },
  },
  {
    name: 'the person prompt after done hides the band, also for a list written again',
    events: [OPEN, DONE, PERSON, DONE],
    expected: { line: null, reads: 1 },
  },
  {
    name: 'the person prompt while items are open keeps the band',
    events: [OPEN, PERSON],
    expected: { line: 'plain:1/4 · Write the parser', reads: 1 },
  },
  {
    name: 'open items after done start a new run and a new read',
    events: [OPEN, DONE, OPEN],
    expected: { line: 'plain:1/4 · Write the parser', reads: 2 },
  },
  {
    name: 'a task in progress is the title, ids from the results',
    events: [
      task('1', 'Write the parser'),
      task('2', 'Test the parser'),
      edit('2', 'in_progress'),
    ],
    expected: { line: 'plain:0/2 · Test the parser', reads: 1 },
  },
  {
    name: 'an update of a task never seen changes nothing',
    events: [task('1', 'Write the parser'), edit('9', 'completed')],
    expected: { line: 'plain:0/1 · Write the parser', reads: 1 },
  },
  {
    name: 'deleting the last task hides the band',
    events: [task('1', 'Write the parser'), { kind: 'taskDeleted', id: '1' }],
    expected: { line: null, reads: 1 },
  },
  {
    name: 'a created task replaces a TodoWrite list',
    events: [OPEN, task('1', 'Write the parser')],
    expected: { line: 'plain:0/1 · Write the parser', reads: 1 },
  },
  {
    name: '/clear hides the band',
    events: [OPEN, { kind: 'cleared' }],
    expected: { line: null, reads: 1 },
  },
  {
    name: 'the answer of the read shows the usage left, also beside done',
    events: [OPEN, answer(USAGE), DONE],
    expected: {
      line: `plain:2/2 done | quiet:${atEdge('2/2 done', 'Codex 5h 62% · week 81%')}`,
      reads: 1,
    },
  },
  {
    name: 'a window below the minimum turns the usage red, a missing window is left out',
    events: [
      OPEN,
      answer('{"primary":null,"secondary":9,"belowMinimum":true}'),
    ],
    expected: {
      line: `plain:1/4 · Write the parser | alarm:${atEdge('1/4 · Write the parser', 'Codex week 9% (below minimum)')}`,
      reads: 1,
    },
  },
  {
    name: 'a read that failed hides the usage',
    events: [OPEN, answer(USAGE), { kind: 'codexRead', budget: null }],
    expected: { line: 'plain:1/4 · Write the parser', reads: 1 },
  },
  {
    name: 'a title with line breaks draws on one line',
    events: [
      {
        kind: 'todosWritten',
        todos: [todo('Write\nthe\r\nparser\u2028now', 'in_progress')],
      },
    ],
    expected: { line: 'plain:0/1 · Write the parser now', reads: 1 },
  },
  {
    name: 'a long title is cut to the width',
    events: [OPEN],
    columns: 16,
    expected: { line: 'plain:1/4 · Write the…', reads: 1 },
  },
  {
    name: 'the usage is cut first when the title would vanish',
    events: [OPEN, answer(USAGE)],
    columns: 30,
    expected: { line: 'plain:1/4 · Write the parser', reads: 1 },
  },
];

/** Runs the usage script against the stand-in app-server and folds its answer in, so the script and the band agree on the report. */
const SCRIPT_CASE = {
  name: 'the script reports a reached limit that credits pay for, red all the same',
  usage: 'credits',
  expected: {
    line: `plain:1/4 · Write the parser | alarm:${atEdge('1/4 · Write the parser', 'Codex 5h 100% · week 0% (below minimum)')}`,
    reads: 1,
  },
};

let failures = 0;

for (const { name, events, columns, expected } of CASES) {
  failures += report(name, fold(events, columns ?? COLUMNS), expected);
}

failures += report(
  SCRIPT_CASE.name,
  fold([OPEN, answer(runScript(SCRIPT_CASE.usage))], COLUMNS),
  SCRIPT_CASE.expected,
);

console.log(failures === 0 ? 'All cases pass.' : `${failures} case(s) failed.`);

process.exit(failures === 0 ? 0 : 1);

/** Folds the events through step from the initial run, the way the hooks module does. */
function fold(events: Event[], columns: number): Result {
  let run = INITIAL_RUN;
  let reads = 0;

  for (const event of events) {
    const next = step(run, event);

    run = next.run;

    if (next.startRead) {
      reads += 1;
    }
  }

  const line = bandLine(run, columns);

  return {
    line:
      line === null ? null : line.map(s => `${s.tone}:${s.text}`).join(' | '),
    reads,
  };
}

/** Pads the Codex text so it ends at the right edge of a band COLUMNS wide, after the given progress. */
function atEdge(progress: string, codex: string): string {
  return `${' '.repeat(COLUMNS - [...progress].length - [...codex].length)}${codex}`;
}

function report(name: string, actual: Result, expected: Result): number {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);

  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  if (!ok) {
    console.log(
      `  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`,
    );
  }

  return ok ? 0 : 1;
}

/** Starts `codex-model.mts --usage` with the stand-in app-server first on PATH and a home without a rule file. */
function runScript(usage: string): string {
  const result = spawnSync(process.execPath, [script, '--usage'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeCodex}:${process.env.PATH}`,
      HOME: join(root, 'tests', 'fixtures', 'codex'),
      FAKE_CODEX_USAGE: usage,
    },
  });

  return result.stdout;
}

function todo(title: string, status: Item['status']): Item {
  return { id: null, title, status };
}

function task(id: string, title: string): Event {
  return { kind: 'taskCreated', task: { id, title, status: 'pending' } };
}

function edit(id: string, status: 'in_progress' | 'completed'): Event {
  return { kind: 'taskEdited', id, title: undefined, status };
}

function answer(stdout: string): Event {
  return { kind: 'codexRead', budget: parseUsage(stdout) };
}

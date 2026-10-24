#!/usr/bin/env node

// Folds the events of each case into the run of the progress band and compares what the band shows and its terminal line with the expected ones.

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bandLine,
  bandOf,
  INITIAL_RUN,
  parseUsage,
  step,
} from '../hooks/progress/run.mts';
import type { Band, Event, Item, Run } from '../hooks/progress/run.mts';

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
  /** The band's line with each part's tone, such as `plain:2/4 · Parse | quiet:<spaces to the right edge>Codex 5h 62%`, null when the band shows nothing. */
  expected: string | null;
}[] = [
  {
    name: 'an open list shows the count and the item in progress',
    events: [OPEN],
    expected: 'plain:1/4 · Write the parser',
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
    expected: 'plain:1/2 · Write the parser',
  },
  {
    name: 'an empty list shows nothing',
    events: [{ kind: 'todosWritten', todos: [] }],
    expected: null,
  },
  {
    name: 'a finished list shows done until the person prompts',
    events: [OPEN, DONE],
    expected: 'plain:2/2 done',
  },
  {
    name: 'the person prompt after done hides the band, also for a list written again',
    events: [OPEN, DONE, PERSON, DONE],
    expected: null,
  },
  {
    name: 'the person prompt while items are open keeps the band',
    events: [OPEN, PERSON],
    expected: 'plain:1/4 · Write the parser',
  },
  {
    name: 'open items after done start a new run',
    events: [OPEN, DONE, OPEN],
    expected: 'plain:1/4 · Write the parser',
  },
  {
    name: 'a task in progress is the title, ids from the results',
    events: [
      task('1', 'Write the parser'),
      task('2', 'Test the parser'),
      edit('2', 'in_progress'),
    ],
    expected: 'plain:0/2 · Test the parser',
  },
  {
    name: 'an update of a task never seen changes nothing',
    events: [task('1', 'Write the parser'), edit('9', 'completed')],
    expected: 'plain:0/1 · Write the parser',
  },
  {
    name: 'deleting the last task hides the band',
    events: [task('1', 'Write the parser'), { kind: 'taskDeleted', id: '1' }],
    expected: null,
  },
  {
    name: 'a created task replaces a TodoWrite list',
    events: [OPEN, task('1', 'Write the parser')],
    expected: 'plain:0/1 · Write the parser',
  },
  {
    name: '/clear hides the band',
    events: [OPEN, { kind: 'cleared' }],
    expected: null,
  },
  {
    name: 'the answer of the read shows the usage left, also beside done',
    events: [OPEN, answer(USAGE), DONE],
    expected: `plain:2/2 done | quiet:${atEdge('2/2 done', 'Codex 5h 62% · week 81%')}`,
  },
  {
    name: 'a window below the minimum turns the usage red, a missing window is left out',
    events: [
      OPEN,
      answer('{"primary":null,"secondary":9,"belowMinimum":true}'),
    ],
    expected: `plain:1/4 · Write the parser | alarm:${atEdge('1/4 · Write the parser', 'Codex week 9% (below minimum)')}`,
  },
  {
    name: 'a read that failed hides the usage',
    events: [OPEN, answer(USAGE), { kind: 'codexRead', budget: null }],
    expected: 'plain:1/4 · Write the parser',
  },
  {
    name: 'a title with line breaks draws on one line',
    events: [
      {
        kind: 'todosWritten',
        todos: [todo('Write\nthe\r\nparser\u2028now', 'in_progress')],
      },
    ],
    expected: 'plain:0/1 · Write the parser now',
  },
  {
    name: 'a long title is cut to the width',
    events: [OPEN],
    columns: 16,
    expected: 'plain:1/4 · Write the…',
  },
  {
    name: 'the usage is cut first when the title would vanish',
    events: [OPEN, answer(USAGE)],
    columns: 30,
    expected: 'plain:1/4 · Write the parser',
  },
  {
    name: 'with no list the usage stands alone at the right edge',
    events: [answer(USAGE)],
    expected: `quiet:${atEdge('', 'Codex 5h 62% · week 81%')}`,
  },
  {
    name: 'the person prompt after done leaves the usage alone',
    events: [OPEN, answer(USAGE), DONE, PERSON],
    expected: `quiet:${atEdge('', 'Codex 5h 62% · week 81%')}`,
  },
  {
    name: 'a window below the minimum turns the usage alone red',
    events: [answer('{"primary":12,"secondary":81,"belowMinimum":true}')],
    expected: `alarm:${atEdge('', 'Codex 5h 12% · week 81% (below minimum)')}`,
  },
  {
    name: 'a read that failed with no list shows nothing',
    events: [answer(USAGE), { kind: 'codexRead', budget: null }],
    expected: null,
  },
  {
    name: 'the usage alone wider than the band starts at the left edge for the terminal to cut',
    events: [answer(USAGE)],
    columns: 10,
    expected: 'quiet:Codex 5h 62% · week 81%',
  },
];

/** What the band shows after the events, the same on every surface. */
const BAND_CASES: { name: string; events: Event[]; expected: Band | null }[] = [
  {
    name: 'the band reads the count, the done share, the item in progress and each window of the usage',
    events: [OPEN, answer(USAGE)],
    expected: {
      progress: { count: '1/4', filled: '25%', title: 'Write the parser' },
      codex: { windows: ['5h 62%', 'week 81%'], tone: 'quiet' },
    },
  },
  {
    name: 'the done share rounds down, so two of three read 66%',
    events: [
      {
        kind: 'todosWritten',
        todos: [
          todo('Read the issue', 'completed'),
          todo('Write the parser', 'completed'),
          todo('Test the parser', 'pending'),
        ],
      },
    ],
    expected: {
      progress: { count: '2/3', filled: '66%', title: 'Test the parser' },
      codex: null,
    },
  },
  {
    name: 'a finished list has no title and a full share',
    events: [OPEN, DONE],
    expected: {
      progress: { count: '2/2', filled: '100%', title: null },
      codex: null,
    },
  },
  {
    name: 'a window below the minimum is the alarm tone, a missing window is left out',
    events: [
      OPEN,
      answer('{"primary":null,"secondary":9,"belowMinimum":true}'),
    ],
    expected: {
      progress: { count: '1/4', filled: '25%', title: 'Write the parser' },
      codex: { windows: ['week 9%'], tone: 'alarm' },
    },
  },
  {
    name: 'a read with neither window shows no usage',
    events: [
      OPEN,
      answer('{"primary":null,"secondary":null,"belowMinimum":false}'),
    ],
    expected: {
      progress: { count: '1/4', filled: '25%', title: 'Write the parser' },
      codex: null,
    },
  },
  {
    name: 'no list shows the usage alone',
    events: [answer(USAGE), OPEN, { kind: 'cleared' }],
    expected: {
      progress: null,
      codex: { windows: ['5h 62%', 'week 81%'], tone: 'quiet' },
    },
  },
  {
    name: 'no list and no usage show no band',
    events: [OPEN, { kind: 'cleared' }],
    expected: null,
  },
];

/** Runs the usage script against the stand-in app-server and folds its answer in, so the script and the band agree on the report. */
const SCRIPT_CASE = {
  name: 'the script reports a reached limit that credits pay for, red all the same',
  usage: 'credits',
  expected: `plain:1/4 · Write the parser | alarm:${atEdge('1/4 · Write the parser', 'Codex 5h 100% · week 0% (below minimum)')}`,
};

let failures = 0;

for (const { name, events, columns, expected } of CASES) {
  failures += report(name, fold(events, columns ?? COLUMNS), expected);
}

for (const { name, events, expected } of BAND_CASES) {
  failures += report(name, bandOf(runOf(events)), expected);
}

failures += report(
  SCRIPT_CASE.name,
  fold([OPEN, answer(runScript(SCRIPT_CASE.usage))], COLUMNS),
  SCRIPT_CASE.expected,
);

console.log(failures === 0 ? 'All cases pass.' : `${failures} case(s) failed.`);

process.exit(failures === 0 ? 0 : 1);

/** Folds the events through step from the initial run, the way the hooks module does, and writes the band's line. */
function fold(events: Event[], columns: number): string | null {
  const band = bandOf(runOf(events));

  return band === null
    ? null
    : bandLine(band, columns)
        .map(s => `${s.tone}:${s.text}`)
        .join(' | ');
}

/** Pads the Codex text so it ends at the right edge of a band COLUMNS wide, after the given progress. */
function atEdge(progress: string, codex: string): string {
  return `${' '.repeat(COLUMNS - [...progress].length - [...codex].length)}${codex}`;
}

/** Folds the events through step from the initial run and returns the run alone. */
function runOf(events: Event[]): Run {
  return events.reduce(step, INITIAL_RUN);
}

function report<T>(name: string, actual: T, expected: T): number {
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

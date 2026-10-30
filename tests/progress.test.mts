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
import type {
  Band,
  Event,
  Item,
  Provider,
  Run,
  Tone,
} from '../hooks/progress/run.mts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(
  root,
  'skills',
  'workflow',
  'engineering',
  'scripts',
  'codex-model.mts',
);

const antigravityScript = join(
  root,
  'skills',
  'workflow',
  'engineering',
  'scripts',
  'antigravity.mts',
);

const fakeCodex = join(root, 'tests', 'fixtures', 'codex', 'bin');

const fakeAgy = join(root, 'tests', 'fixtures', 'antigravity', 'bin');

/** The band's width for every case that names none. */
const COLUMNS = 200;

const USAGE = '{"primary":62,"secondary":81,"belowMinimum":false}';

const AGY_USAGE = '{"groups":{"Gemini Models":91},"belowMinimum":false}';

const AGY_LOW_USAGE = '{"groups":{"Gemini Models":12},"belowMinimum":true}';

const AGY_GROUPS_USAGE =
  '{"groups":{"Gemini Models":91,"Gemini 4 Argon":40},"belowMinimum":false}';

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

const CLAUDE: Event = { kind: 'claudeMeasured', left: 77 };

const CODEX = 'Codex 5h 62% · week 81%';

const AGY = 'Antigravity week 91%';

const AGY_LOW = 'Antigravity week 12% (below minimum)';

const AGY_GROUPS = 'Antigravity Gemini 91% · Argon 40%';

const LEFT = '1/4 · Write the parser';

const CASES: {
  name: string;
  events: Event[];
  columns?: number;
  /** The band's line with each part's tone, such as `quiet:Claude 5h 77% ·  | plain:2/4 · Parse | quiet:<spaces to the right edge>Codex 5h 62%`, null when the band shows nothing. */
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
    events: [OPEN, answer(USAGE), failedRead('codex')],
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
    name: 'done wider than the band is left for the terminal to cut',
    events: [OPEN, DONE],
    columns: 5,
    expected: 'plain:2/2 done',
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
    events: [answer(USAGE), failedRead('codex')],
    expected: null,
  },
  {
    name: 'the usage alone wider than the band starts at the left edge for the terminal to cut',
    events: [answer(USAGE)],
    columns: 10,
    expected: 'quiet:Codex 5h 62% · week 81%',
  },
  {
    name: 'the Claude usage alone stands at the left edge',
    events: [CLAUDE],
    expected: 'quiet:Claude 5h 77%',
  },
  {
    name: 'the Claude usage comes first, then the progress and the Codex usage at the right edge',
    events: [CLAUDE, OPEN, answer(USAGE)],
    expected: `quiet:Claude 5h 77% ·  | plain:1/4 · Write the parser | quiet:${atEdge('Claude 5h 77% · 1/4 · Write the parser', CODEX)}`,
  },
  {
    name: 'the Claude usage stands beside done',
    events: [CLAUDE, OPEN, DONE],
    expected: 'quiet:Claude 5h 77% ·  | plain:2/2 done',
  },
  {
    name: 'with no list the Claude usage stands at the left edge and the Codex usage at the right edge',
    events: [CLAUDE, answer(USAGE)],
    expected: `quiet:Claude 5h 77% | quiet:${atEdge('Claude 5h 77%', CODEX)}`,
  },
  {
    name: 'a measurement with no reading hides the Claude usage',
    events: [CLAUDE, OPEN, { kind: 'claudeMeasured', left: null }],
    expected: 'plain:1/4 · Write the parser',
  },
  {
    name: 'a narrow band cuts the title and the Codex usage before the Claude usage',
    events: [CLAUDE, OPEN, answer(USAGE)],
    columns: 30,
    expected: 'quiet:Claude 5h 77% ·  | plain:1/4 · Write t…',
  },
  {
    name: 'the Claude usage is cut once it and the count no longer fit',
    events: [CLAUDE, OPEN, answer(USAGE)],
    columns: 20,
    expected: 'plain:1/4 · Write the par…',
  },
  {
    name: 'the Claude usage keeps the left edge when the Codex usage does not fit beside it',
    events: [CLAUDE, answer(USAGE)],
    columns: 30,
    expected: 'quiet:Claude 5h 77%',
  },
  {
    name: 'the Claude usage alone wider than the band is left for the terminal to cut',
    events: [CLAUDE],
    columns: 5,
    expected: 'quiet:Claude 5h 77%',
  },
  {
    name: 'the Codex usage comes first and the Antigravity usage follows at the right edge, whatever the order of the reads',
    events: [OPEN, answerAntigravity(AGY_USAGE), answer(USAGE)],
    expected: `plain:${LEFT} | ${atEdgeOf(LEFT, COLUMNS, ['quiet', CODEX], ['quiet', AGY])}`,
  },
  {
    name: 'the Antigravity usage alone stands beside the list',
    events: [OPEN, answerAntigravity(AGY_USAGE)],
    expected: `plain:${LEFT} | ${atEdgeOf(LEFT, COLUMNS, ['quiet', AGY])}`,
  },
  {
    name: 'with no list the Antigravity usage stands alone at the right edge',
    events: [answerAntigravity(AGY_USAGE)],
    expected: atEdgeOf('', COLUMNS, ['quiet', AGY]),
  },
  {
    name: 'with no list both usages stand at the right edge',
    events: [answer(USAGE), answerAntigravity(AGY_USAGE)],
    expected: atEdgeOf('', COLUMNS, ['quiet', CODEX], ['quiet', AGY]),
  },
  {
    name: 'a limit below the minimum turns the Antigravity usage red and leaves the Codex usage',
    events: [OPEN, answer(USAGE), answerAntigravity(AGY_LOW_USAGE)],
    expected: `plain:${LEFT} | ${atEdgeOf(LEFT, COLUMNS, ['quiet', CODEX], ['alarm', AGY_LOW])}`,
  },
  {
    name: 'several groups are named by a short name taken from the group',
    events: [OPEN, answerAntigravity(AGY_GROUPS_USAGE)],
    expected: `plain:${LEFT} | ${atEdgeOf(LEFT, COLUMNS, ['quiet', AGY_GROUPS])}`,
  },
  {
    name: 'a read of the Antigravity usage that failed leaves the Codex usage',
    events: [
      OPEN,
      answer(USAGE),
      answerAntigravity(AGY_USAGE),
      failedRead('antigravity'),
    ],
    expected: `plain:${LEFT} | ${atEdgeOf(LEFT, COLUMNS, ['quiet', CODEX])}`,
  },
  {
    name: 'a read of the Codex usage that failed leaves the Antigravity usage',
    events: [
      OPEN,
      answer(USAGE),
      answerAntigravity(AGY_USAGE),
      failedRead('codex'),
    ],
    expected: `plain:${LEFT} | ${atEdgeOf(LEFT, COLUMNS, ['quiet', AGY])}`,
  },
  {
    name: 'a report of the other provider shows no usage',
    events: [answer(AGY_USAGE), answerAntigravity(USAGE)],
    expected: null,
  },
  {
    name: 'a narrow band cuts the title before it leaves out the Antigravity usage',
    events: [OPEN, answer(USAGE), answerAntigravity(AGY_USAGE)],
    columns: 57,
    expected: `plain:1/4 · … | ${atEdgeOf('1/4 · …', 57, ['quiet', CODEX], ['quiet', AGY])}`,
  },
  {
    name: 'the Antigravity usage is the first to go once the title would vanish',
    events: [OPEN, answer(USAGE), answerAntigravity(AGY_USAGE)],
    columns: 56,
    expected: `plain:${LEFT} | ${atEdgeOf(LEFT, 56, ['quiet', CODEX])}`,
  },
  {
    name: 'the Codex usage goes next, once the title would vanish again',
    events: [OPEN, answer(USAGE), answerAntigravity(AGY_USAGE)],
    columns: 33,
    expected: 'plain:1/4 · Write the parser',
  },
  {
    name: 'a narrow band leaves out the Antigravity usage and the Codex usage before the Claude usage',
    events: [CLAUDE, OPEN, answer(USAGE), answerAntigravity(AGY_USAGE)],
    columns: 30,
    expected: 'quiet:Claude 5h 77% ·  | plain:1/4 · Write t…',
  },
  {
    name: 'the Claude usage keeps the left edge while the Antigravity usage goes first',
    events: [CLAUDE, OPEN, answer(USAGE), answerAntigravity(AGY_USAGE)],
    columns: 70,
    expected: `quiet:Claude 5h 77% ·  | plain:${LEFT} | ${atEdgeOf(`Claude 5h 77% · ${LEFT}`, 70, ['quiet', CODEX])}`,
  },
  {
    name: 'with no list the Antigravity usage goes before the Codex usage',
    events: [answer(USAGE), answerAntigravity(AGY_USAGE)],
    columns: 40,
    expected: atEdgeOf('', 40, ['quiet', CODEX]),
  },
  {
    name: 'with no list the Codex usage alone wider than the band starts at the left edge for the terminal to cut',
    events: [answer(USAGE), answerAntigravity(AGY_USAGE)],
    columns: 10,
    expected: 'quiet:Codex 5h 62% · week 81%',
  },
];

/** What the band shows after the events, the same on every surface. */
const BAND_CASES: { name: string; events: Event[]; expected: Band | null }[] = [
  {
    name: 'the band reads the Claude window, the count, the done share, the item in progress and each window of the usage',
    events: [CLAUDE, OPEN, answer(USAGE)],
    expected: {
      claude: { window: '5h 77%' },
      progress: { count: '1/4', filled: '25%', title: 'Write the parser' },
      usages: [
        { label: 'Codex', readings: ['5h 62%', 'week 81%'], tone: 'quiet' },
      ],
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
      claude: null,
      progress: { count: '2/3', filled: '66%', title: 'Test the parser' },
      usages: [],
    },
  },
  {
    name: 'a finished list has no title and a full share',
    events: [OPEN, DONE],
    expected: {
      claude: null,
      progress: { count: '2/2', filled: '100%', title: null },
      usages: [],
    },
  },
  {
    name: 'a window below the minimum is the alarm tone, a missing window is left out',
    events: [
      OPEN,
      answer('{"primary":null,"secondary":9,"belowMinimum":true}'),
    ],
    expected: {
      claude: null,
      progress: { count: '1/4', filled: '25%', title: 'Write the parser' },
      usages: [{ label: 'Codex', readings: ['week 9%'], tone: 'alarm' }],
    },
  },
  {
    name: 'a read with neither window shows no usage',
    events: [
      OPEN,
      answer('{"primary":null,"secondary":null,"belowMinimum":false}'),
    ],
    expected: {
      claude: null,
      progress: { count: '1/4', filled: '25%', title: 'Write the parser' },
      usages: [],
    },
  },
  {
    name: 'no list shows the usage alone',
    events: [answer(USAGE), OPEN, { kind: 'cleared' }],
    expected: {
      claude: null,
      progress: null,
      usages: [
        { label: 'Codex', readings: ['5h 62%', 'week 81%'], tone: 'quiet' },
      ],
    },
  },
  {
    name: 'the Claude usage alone is a band',
    events: [answer('not json'), CLAUDE],
    expected: { claude: { window: '5h 77%' }, progress: null, usages: [] },
  },
  {
    name: 'the usages follow the order of the providers, not the order of the reads',
    events: [answerAntigravity(AGY_USAGE), answer(USAGE)],
    expected: {
      claude: null,
      progress: null,
      usages: [
        { label: 'Codex', readings: ['5h 62%', 'week 81%'], tone: 'quiet' },
        { label: 'Antigravity', readings: ['week 91%'], tone: 'quiet' },
      ],
    },
  },
  {
    name: 'a limit below the minimum is the alarm tone of the Antigravity usage alone',
    events: [answer(USAGE), answerAntigravity(AGY_LOW_USAGE)],
    expected: {
      claude: null,
      progress: null,
      usages: [
        { label: 'Codex', readings: ['5h 62%', 'week 81%'], tone: 'quiet' },
        { label: 'Antigravity', readings: ['week 12%'], tone: 'alarm' },
      ],
    },
  },
  {
    name: 'several groups read by the short name of the group, Gemini for the shared group',
    events: [answerAntigravity(AGY_GROUPS_USAGE)],
    expected: {
      claude: null,
      progress: null,
      usages: [
        {
          label: 'Antigravity',
          readings: ['Gemini 91%', 'Argon 40%'],
          tone: 'quiet',
        },
      ],
    },
  },
  {
    name: 'a group name without a version or the word Models is its own short name',
    events: [
      answerAntigravity(
        '{"groups":{"Gemini Models":91,"Gemini Argon":40,"Premium Models":55},"belowMinimum":false}',
      ),
    ],
    expected: {
      claude: null,
      progress: null,
      usages: [
        {
          label: 'Antigravity',
          readings: ['Gemini 91%', 'Argon 40%', 'Premium 55%'],
          tone: 'quiet',
        },
      ],
    },
  },
  {
    name: 'an Antigravity report without a group shows no usage',
    events: [OPEN, answerAntigravity('{"groups":{},"belowMinimum":false}')],
    expected: {
      claude: null,
      progress: { count: '1/4', filled: '25%', title: 'Write the parser' },
      usages: [],
    },
  },
  {
    name: 'an Antigravity report with a percent that is no whole number shows no usage',
    events: [
      OPEN,
      answerAntigravity(
        '{"groups":{"Gemini Models":91.5},"belowMinimum":false}',
      ),
    ],
    expected: {
      claude: null,
      progress: { count: '1/4', filled: '25%', title: 'Write the parser' },
      usages: [],
    },
  },
  {
    name: 'an Antigravity report with groups as a list shows no usage',
    events: [OPEN, answerAntigravity('{"groups":[91],"belowMinimum":false}')],
    expected: {
      claude: null,
      progress: { count: '1/4', filled: '25%', title: 'Write the parser' },
      usages: [],
    },
  },
  {
    name: 'no list and no usage show no band',
    events: [
      CLAUDE,
      OPEN,
      { kind: 'cleared' },
      { kind: 'claudeMeasured', left: null },
    ],
    expected: null,
  },
];

/** Runs the usage script of a provider against its stand-in CLI and folds its answer in, so the script and the band agree on the report. */
const SCRIPT_CASES: {
  name: string;
  provider: Provider;
  usage: string;
  expected: string;
}[] = [
  {
    name: 'the Codex script reports a reached limit that credits pay for, red all the same',
    provider: 'codex',
    usage: 'credits',
    expected: `plain:${LEFT} | alarm:${atEdge(LEFT, 'Codex 5h 100% · week 0% (below minimum)')}`,
  },
  {
    name: 'the Antigravity script reports the groups of its own, red once one is below the minimum',
    provider: 'antigravity',
    usage: 'argon-group',
    expected: `plain:${LEFT} | alarm:${atEdge(LEFT, 'Antigravity Gemini 92% · Argon 10% (below minimum)')}`,
  },
];

let failures = 0;

for (const { name, events, columns, expected } of CASES) {
  failures += report(name, fold(events, columns ?? COLUMNS), expected);
}

for (const { name, events, expected } of BAND_CASES) {
  failures += report(name, bandOf(runOf(events)), expected);
}

for (const { name, provider, usage, expected } of SCRIPT_CASES) {
  failures += report(
    name,
    fold([OPEN, answerRead(provider, runScript(provider, usage))], COLUMNS),
    expected,
  );
}

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

/** Pads the Codex text so it ends at the right edge of a band COLUMNS wide, after the given text on its left. */
function atEdge(left: string, codex: string): string {
  return `${' '.repeat(COLUMNS - [...left].length - [...codex].length)}${codex}`;
}

/** Writes the segments of the usages at the right edge of a band the given columns wide, after the given text on its left, the first padded to the edge and each next one after the gap of three columns. */
function atEdgeOf(
  left: string,
  columns: number,
  ...usages: [Exclude<Tone, 'plain'>, string][]
): string {
  const gaps = 3 * (usages.length - 1);
  const used = usages.reduce((total, [, text]) => total + [...text].length, 0);
  const pad = Math.max(0, columns - [...left].length - used - gaps);

  return usages
    .map(
      ([tone, text], index) =>
        `${tone}:${' '.repeat(index === 0 ? pad : 3)}${text}`,
    )
    .join(' | ');
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

/** Starts the `--usage` script of the provider with its stand-in CLI first on PATH and a home without a rule file. */
function runScript(provider: Provider, usage: string): string {
  const stand: Record<Provider, { script: string; env: NodeJS.ProcessEnv }> = {
    codex: {
      script,
      env: {
        PATH: `${fakeCodex}:${process.env.PATH}`,
        FAKE_CODEX_USAGE: usage,
      },
    },
    antigravity: {
      script: antigravityScript,
      env: { PATH: `${fakeAgy}:${process.env.PATH}`, FAKE_AGY_USAGE: usage },
    },
  };

  const result = spawnSync(
    process.execPath,
    [stand[provider].script, '--usage'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: join(root, 'tests', 'fixtures', 'codex'),
        ...stand[provider].env,
      },
    },
  );

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

/** The read of the Codex script that printed the given stdout. */
function answer(stdout: string): Event {
  return answerRead('codex', stdout);
}

/** The read of the Antigravity script that printed the given stdout. */
function answerAntigravity(stdout: string): Event {
  return answerRead('antigravity', stdout);
}

function answerRead(provider: Provider, stdout: string): Event {
  return { kind: 'usageRead', provider, budget: parseUsage(provider, stdout) };
}

/** The read of a script that failed, which leaves nothing to show. */
function failedRead(provider: Provider): Event {
  return { kind: 'usageRead', provider, budget: null };
}

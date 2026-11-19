#!/usr/bin/env node

// Folds the events of each case into the run of the progress band and compares what the band shows and its terminal line with the expected ones.

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bandLine,
  bandOf,
  INITIAL_RUN,
  parseModelLimits,
  parseUsage,
  step,
} from '../plugins/forge/hooks/progress/run.mts';
import type {
  Band,
  Event,
  Item,
  Limit,
  Provider,
  Run,
  Tone,
} from '../plugins/forge/hooks/progress/run.mts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(
  root,
  'plugins',
  'forge',
  'skills',
  'workflow',
  'engineering',
  'scripts',
  'codex-model.mts',
);

const antigravityScript = join(
  root,
  'plugins',
  'forge',
  'skills',
  'workflow',
  'engineering',
  'scripts',
  'antigravity-model.mts',
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

const CLAUDE: Event = {
  kind: 'claudeMeasured',
  windows: [{ name: '5h', left: 77 }],
};

/** The weekly window of an account with no 5-hour window, 67% left. */
const WEEK: Event = {
  kind: 'claudeMeasured',
  windows: [{ name: 'week', left: 67 }],
};

/** The body of the usage endpoint with the weekly limit of the Fable model, 43% used. */
const MODELS_BODY =
  '{"five_hour":null,"seven_day":{"utilization":33.0},"limits":[{"kind":"weekly_all","percent":33,"scope":null},{"kind":"weekly_scoped","percent":43,"scope":{"model":{"id":null,"display_name":"Fable"},"surface":null}}]}';

/** The weekly limit of the Fable model read from the body, 57% left. */
const FABLE: Event = {
  kind: 'claudeModelsRead',
  models: parseModelLimits(MODELS_BODY),
};

/** The read of the model limits that failed, which leaves none. */
const NO_MODELS: Event = { kind: 'claudeModelsRead', models: [] };

/** The context window 34% used. */
const CONTEXT: Event = { kind: 'contextMeasured', percent: 34 };

/** The context window after a compaction, with no figure. */
const NO_CONTEXT: Event = { kind: 'contextMeasured', percent: null };

const CLAUDE_5H = 'Claude 5h 77%';

const CLAUDE_CONTEXT_5H = 'Claude Context 34% · 5h 77%';

const CLAUDE_WEEK = 'Claude week 67% · Fable 57%';

const CODEX = 'Codex 5h 62% · week 81%';

const AGY = 'Antigravity week 91%';

const AGY_LOW = 'Antigravity week 12% (below minimum)';

const AGY_GROUPS = 'Antigravity Gemini 91% · Argon 40%';

const LEFT = '1/4 · Write the parser';

const CASES: {
  name: string;
  events: Event[];
  columns?: number;
  /** The band's line with each part's tone, such as `plain:2/4 · Parse | quiet:<spaces to the right edge>Claude 5h 77%   Codex 5h 62%`, null when the band shows nothing. */
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
    name: 'the Claude usage alone stands at the right edge',
    events: [CLAUDE],
    expected: atEdgeOf('', COLUMNS, ['quiet', CLAUDE_5H]),
  },
  {
    name: 'the progress stands at the left edge and the Claude usage at the right edge',
    events: [CLAUDE, OPEN],
    expected: `plain:${LEFT} | ${atEdgeOf(LEFT, COLUMNS, ['quiet', CLAUDE_5H])}`,
  },
  {
    name: 'the Claude usage stands beside done',
    events: [CLAUDE, OPEN, DONE],
    expected: `plain:2/2 done | ${atEdgeOf('2/2 done', COLUMNS, ['quiet', CLAUDE_5H])}`,
  },
  {
    name: 'with no list the Claude usage comes first and the Codex usage follows three columns after it',
    events: [CLAUDE, answer(USAGE)],
    expected: atEdgeOf('', COLUMNS, ['quiet', CLAUDE_5H], ['quiet', CODEX]),
  },
  {
    name: 'the Claude, the Codex and the Antigravity usage stand side by side at the right edge, whatever the order of the reads',
    events: [CLAUDE, OPEN, answerAntigravity(AGY_USAGE), answer(USAGE)],
    expected: `plain:${LEFT} | ${atEdgeOf(LEFT, COLUMNS, ['quiet', CLAUDE_5H], ['quiet', CODEX], ['quiet', AGY])}`,
  },
  {
    name: 'a measurement with no reading hides the Claude usage',
    events: [CLAUDE, OPEN, { kind: 'claudeMeasured', windows: [] }],
    expected: 'plain:1/4 · Write the parser',
  },
  {
    name: 'a narrow band cuts the title before it leaves out the Antigravity usage',
    events: [CLAUDE, OPEN, answer(USAGE), answerAntigravity(AGY_USAGE)],
    columns: 73,
    expected: `plain:1/4 · … | ${atEdgeOf('1/4 · …', 73, ['quiet', CLAUDE_5H], ['quiet', CODEX], ['quiet', AGY])}`,
  },
  {
    name: 'the Antigravity usage is the first to go once the title would vanish beside the Claude usage',
    events: [CLAUDE, OPEN, answer(USAGE), answerAntigravity(AGY_USAGE)],
    columns: 72,
    expected: `plain:${LEFT} | ${atEdgeOf(LEFT, 72, ['quiet', CLAUDE_5H], ['quiet', CODEX])}`,
  },
  {
    name: 'the Codex usage goes next and leaves the Claude usage',
    events: [CLAUDE, OPEN, answer(USAGE), answerAntigravity(AGY_USAGE)],
    columns: 49,
    expected: `plain:${LEFT} | ${atEdgeOf(LEFT, 49, ['quiet', CLAUDE_5H])}`,
  },
  {
    name: 'the Claude usage goes last, once the title would vanish beside it',
    events: [CLAUDE, OPEN, answer(USAGE), answerAntigravity(AGY_USAGE)],
    columns: 23,
    expected: `plain:${LEFT}`,
  },
  {
    name: 'the Claude usage is cut once it and the count no longer fit',
    events: [CLAUDE, OPEN, answer(USAGE)],
    columns: 20,
    expected: 'plain:1/4 · Write the par…',
  },
  {
    name: 'with no list the Claude usage stays when the Codex usage does not fit beside it',
    events: [CLAUDE, answer(USAGE)],
    columns: 30,
    expected: atEdgeOf('', 30, ['quiet', CLAUDE_5H]),
  },
  {
    name: 'the Claude usage alone wider than the band starts at the left edge for the terminal to cut',
    events: [CLAUDE],
    columns: 5,
    expected: 'quiet:Claude 5h 77%',
  },
  {
    name: 'the context stands first in the Claude usage, before the windows',
    events: [CLAUDE, CONTEXT],
    expected: atEdgeOf('', COLUMNS, ['quiet', CLAUDE_CONTEXT_5H]),
  },
  {
    name: 'the context stands alone in the Claude usage with no window',
    events: [CONTEXT],
    expected: atEdgeOf('', COLUMNS, ['quiet', 'Claude Context 34%']),
  },
  {
    name: 'the context stands before the weekly window and the model limit',
    events: [WEEK, FABLE, CONTEXT],
    expected: atEdgeOf('', COLUMNS, [
      'quiet',
      'Claude Context 34% · week 67% · Fable 57%',
    ]),
  },
  {
    name: 'a measurement with no context figure takes the context away and keeps the windows',
    events: [CLAUDE, CONTEXT, NO_CONTEXT],
    expected: atEdgeOf('', COLUMNS, ['quiet', CLAUDE_5H]),
  },
  {
    name: 'a measurement with no window keeps the context',
    events: [CLAUDE, CONTEXT, { kind: 'claudeMeasured', windows: [] }],
    expected: atEdgeOf('', COLUMNS, ['quiet', 'Claude Context 34%']),
  },
  {
    name: 'the context is the Claude usage beside the Codex usage and the list',
    events: [CONTEXT, OPEN, answer(USAGE)],
    expected: `plain:${LEFT} | ${atEdgeOf(LEFT, COLUMNS, ['quiet', 'Claude Context 34%'], ['quiet', CODEX])}`,
  },
  {
    name: 'an account with no 5-hour window shows its weekly window at the right edge',
    events: [WEEK],
    expected: atEdgeOf('', COLUMNS, ['quiet', 'Claude week 67%']),
  },
  {
    name: 'the weekly limit of a model follows the weekly window',
    events: [WEEK, FABLE],
    expected: atEdgeOf('', COLUMNS, ['quiet', CLAUDE_WEEK]),
  },
  {
    name: 'the weekly window and the model limit stand before the Codex usage at the right edge',
    events: [WEEK, FABLE, OPEN, answer(USAGE)],
    expected: `plain:${LEFT} | ${atEdgeOf(LEFT, COLUMNS, ['quiet', CLAUDE_WEEK], ['quiet', CODEX])}`,
  },
  {
    name: 'a failed read of the model limits leaves the weekly window',
    events: [WEEK, FABLE, NO_MODELS],
    expected: atEdgeOf('', COLUMNS, ['quiet', 'Claude week 67%']),
  },
  {
    name: 'a 5-hour reading clears the model limits and keeps the 5-hour window as it was',
    events: [WEEK, FABLE, CLAUDE, NO_MODELS],
    expected: atEdgeOf('', COLUMNS, ['quiet', CLAUDE_5H]),
  },
  {
    name: 'a narrow band cuts the title and leaves out the usages after the weekly window and the model limit',
    events: [WEEK, FABLE, OPEN, answer(USAGE), answerAntigravity(AGY_USAGE)],
    columns: 40,
    expected: `plain:1/4 · Wr… | ${atEdgeOf('1/4 · Wr…', 40, ['quiet', CLAUDE_WEEK])}`,
  },
  {
    name: 'the weekly window and the model limit are left out once the title would vanish beside them',
    events: [WEEK, FABLE, OPEN, answer(USAGE), answerAntigravity(AGY_USAGE)],
    columns: 37,
    expected: `plain:${LEFT}`,
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
    name: 'the band reads the count, the done share, the item in progress, the Claude window and each window of the usage',
    events: [CLAUDE, OPEN, answer(USAGE)],
    expected: {
      progress: { count: '1/4', filled: '25%', title: 'Write the parser' },
      usages: [
        { label: 'Claude', readings: ['5h 77%'], tone: 'quiet' },
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
      progress: { count: '2/3', filled: '66%', title: 'Test the parser' },
      usages: [],
    },
  },
  {
    name: 'a finished list has no title and a full share',
    events: [OPEN, DONE],
    expected: {
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
      progress: { count: '1/4', filled: '25%', title: 'Write the parser' },
      usages: [],
    },
  },
  {
    name: 'no list shows the usage alone',
    events: [answer(USAGE), OPEN, { kind: 'cleared' }],
    expected: {
      progress: null,
      usages: [
        { label: 'Codex', readings: ['5h 62%', 'week 81%'], tone: 'quiet' },
      ],
    },
  },
  {
    name: 'the Claude usage alone is a band',
    events: [answer('not json'), CLAUDE],
    expected: {
      progress: null,
      usages: [{ label: 'Claude', readings: ['5h 77%'], tone: 'quiet' }],
    },
  },
  {
    name: 'the Claude usage reads the weekly window and the limit of each model',
    events: [WEEK, FABLE],
    expected: {
      progress: null,
      usages: [
        {
          label: 'Claude',
          readings: ['week 67%', 'Fable 57%'],
          tone: 'quiet',
        },
      ],
    },
  },
  {
    name: 'the Claude usage keeps the 5-hour window alone, whatever the model limits were',
    events: [WEEK, FABLE, CLAUDE, NO_MODELS],
    expected: {
      progress: null,
      usages: [{ label: 'Claude', readings: ['5h 77%'], tone: 'quiet' }],
    },
  },
  {
    name: 'the Claude usage comes before the providers, which follow the order of the providers, not the order of the reads',
    events: [answerAntigravity(AGY_USAGE), answer(USAGE), CLAUDE],
    expected: {
      progress: null,
      usages: [
        { label: 'Claude', readings: ['5h 77%'], tone: 'quiet' },
        { label: 'Codex', readings: ['5h 62%', 'week 81%'], tone: 'quiet' },
        { label: 'Antigravity', readings: ['week 91%'], tone: 'quiet' },
      ],
    },
  },
  {
    name: 'a limit below the minimum is the alarm tone of the Antigravity usage alone',
    events: [answer(USAGE), answerAntigravity(AGY_LOW_USAGE)],
    expected: {
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
      progress: { count: '1/4', filled: '25%', title: 'Write the parser' },
      usages: [],
    },
  },
  {
    name: 'an Antigravity report with groups as a list shows no usage',
    events: [OPEN, answerAntigravity('{"groups":[91],"belowMinimum":false}')],
    expected: {
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
      { kind: 'claudeMeasured', windows: [] },
    ],
    expected: null,
  },
];

/** The weekly limits per model a body of the usage endpoint holds, none for a body that is no usage body. */
const MODEL_LIMIT_CASES: { name: string; body: string; expected: Limit[] }[] = [
  {
    name: 'the weekly limit of a model is its percent left under the display name',
    body: MODELS_BODY,
    expected: [{ name: 'Fable', left: 57 }],
  },
  {
    name: 'every weekly limit of a model is taken, the weekly limit of the account is not',
    body: '{"limits":[{"kind":"weekly_all","percent":10,"scope":null},{"kind":"weekly_scoped","percent":43,"scope":{"model":{"display_name":"Fable"}}},{"kind":"weekly_scoped","percent":100.5,"scope":{"model":{"display_name":"Opus"}}}]}',
    expected: [
      { name: 'Fable', left: 57 },
      { name: 'Opus', left: 0 },
    ],
  },
  {
    name: 'a limit scoped to no model is left out',
    body: '{"limits":[{"kind":"weekly_scoped","percent":43,"scope":{"model":null,"surface":"cli"}}]}',
    expected: [],
  },
  {
    name: 'a limit without a display name or a number as its percent is left out',
    body: '{"limits":[{"kind":"weekly_scoped","percent":43,"scope":{"model":{"display_name":""}}},{"kind":"weekly_scoped","percent":"43","scope":{"model":{"display_name":"Fable"}}}]}',
    expected: [],
  },
  {
    name: 'a body with no list of limits shows none',
    body: '{"five_hour":null}',
    expected: [],
  },
  {
    name: 'a body that is no JSON shows none',
    body: 'not json',
    expected: [],
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

for (const { name, body, expected } of MODEL_LIMIT_CASES) {
  failures += report(name, parseModelLimits(body), expected);
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

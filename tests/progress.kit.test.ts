// Drives the hooks module of this plugin through the engine's own events and reads the line it draws above the prompt.
// https://code.claude.com/docs/en/plugins/mods/reference.md

import type { On, SessionRateLimit } from 'claude-code';
import { expect, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';

/** Declares the timer the test environment has and the engine's declarations leave out. */
declare function setTimeout(callback: () => void, ms: number): unknown;

const GRAPHICAL_SURFACES = ['desktop', 'mobile'] as const;

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 4,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 3 },
  view: {},
};

const TODOS = [
  { content: 'Read the issue', status: 'completed', activeForm: 'Reading' },
  { content: 'Write the parser', status: 'in_progress', activeForm: 'Writing' },
  { content: 'Test the parser', status: 'pending', activeForm: 'Testing' },
] as const;

const USAGE = '{"primary":62,"secondary":81,"belowMinimum":false}\n';

const LOW_USAGE = '{"primary":12,"secondary":81,"belowMinimum":true}\n';

const AGY_USAGE = '{"groups":{"Gemini Models":91},"belowMinimum":false}\n';

const AGY_LOW_USAGE = '{"groups":{"Gemini Models":12},"belowMinimum":true}\n';

const AGY_GROUPS_USAGE =
  '{"groups":{"Gemini Models":91,"Gemini 4 Argon":40},"belowMinimum":false}\n';

const CODEX = 'Codex 5h 62% · week 81%';

const AGY = 'Antigravity week 91%';

/** A reading of the current session with 77.5% left, which the band rounds down to 77%. */
const SESSION = [
  { kind: 'five_hour', percentUsed: 22.5, resetsAt: '2026-10-24T18:00:00Z' },
  { kind: 'seven_day', percentUsed: 40 },
];

test('a TodoWrite of the main loop draws the count and the item in progress', async ($, on) => {
  answerEngine(on, USAGE);
  await startSession($);
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] });
  await settled();

  expect(await drawn($)).toBe(
    atEdge('1/3 · Write the parser', 'Codex 5h 62% · week 81%'),
  );
});

test('desktop and mobile draw the count with a bar of the done share, the title the surface truncates and the usage as a caption', async ($, on) => {
  answerEngine(on, USAGE);
  await startSession($);
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] });
  await settled();

  for (const surface of GRAPHICAL_SURFACES) {
    expect(await graphicalBand($, surface)).toEqual({
      row: { flexDirection: 'row', alignItems: 'center', gap: 'sm' },
      progress: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 'xs',
        flexShrink: 0,
      },
      count: { tabular: true, weight: 'medium', text: '1/3' },
      track: { width: 8, height: 1, backgroundColor: 'subtle' },
      fill: { width: '33%', height: 1, backgroundColor: 'claude' },
      title: {
        flexGrow: 1,
        minWidth: 0,
        wrap: 'truncate-end',
        text: 'Write the parser',
      },
      caption: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 'xs',
        flexShrink: 0,
      },
      codex: [
        { size: 'caption', dimColor: true, text: 'Codex' },
        { size: 'caption', tabular: true, text: '5h 62%' },
        { size: 'caption', dimColor: true, text: '·' },
        { size: 'caption', tabular: true, text: 'week 81%' },
      ],
    });
  }
});

test('desktop and mobile draw a finished list as a full bar in the success color and a dim done', async ($, on) => {
  answerEngine(on, USAGE);
  await startSession($);
  await $.tool.call({
    tool: 'TaskCreate',
    subject: 'Write the parser',
    description: '',
  });

  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'completed' });
  await settled();

  for (const surface of GRAPHICAL_SURFACES) {
    const { count, fill, title } = await graphicalBand($, surface);

    expect({ count, fill, title }).toEqual({
      count: { tabular: true, weight: 'medium', text: '1/1' },
      fill: { width: '100%', height: 1, backgroundColor: 'success' },
      title: { flexGrow: 1, minWidth: 0, dimColor: true, text: 'done' },
    });
  }
});

test('a TodoWrite of a subagent draws nothing', async ($, on) => {
  answerEngine(on, USAGE);
  // The kit's typed call leaves out agentId, which the engine still passes to the plugin as a subagent's loop.
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [...TODOS],
    agentId: 'a1',
  } as never);

  await settled();

  expect(await drawn($)).toBe('ENGINE');
});

test('a TodoWrite the tool reports as an error draws nothing', async ($, on) => {
  // The test's hooks nest in the order they are registered, so this answer stands before answerEngine's.
  on('tool.call', { tool: 'TodoWrite' }, () => ({
    result: { oldTodos: [], newTodos: [] },
    isError: true,
  }));

  answerEngine(on, USAGE);
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] });
  await settled();

  expect(await drawn($)).toBe('ENGINE');
});

test('a task takes its id from the result and done ends on the person prompt only, leaving the usage alone', async ($, on) => {
  answerEngine(on, USAGE);
  await startSession($);
  await $.tool.call({
    tool: 'TaskCreate',
    subject: 'Write the parser',
    description: '',
  });

  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'completed' });
  await settled();
  expect(await drawn($)).toBe(atEdge('1/1 done', 'Codex 5h 62% · week 81%'));

  await $.prompt.submit({
    text: 'done?',
    wait: false,
    origin: { kind: 'task-notification' },
  });

  await settled();
  expect(await drawn($)).toBe(atEdge('1/1 done', 'Codex 5h 62% · week 81%'));

  await $.prompt.submit({
    text: 'next',
    wait: false,
    origin: { kind: 'composer' },
  });

  await settled();
  expect(await drawn($)).toBe(atEdge('', 'Codex 5h 62% · week 81%'));
});

test('a meta prompt keeps done on the band', async ($, on) => {
  answerEngine(on, USAGE);
  await startSession($);
  await $.tool.call({
    tool: 'TaskCreate',
    subject: 'Write the parser',
    description: '',
  });

  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'completed' });

  // The kit's typed call leaves out isMeta, which the engine passes for an idle notice or a delivery receipt.
  await $.prompt.submit({
    text: 'idle',
    wait: false,
    origin: { kind: 'composer' },
    isMeta: true,
  } as never);

  await settled();
  expect(await drawn($)).toBe(atEdge('1/1 done', 'Codex 5h 62% · week 81%'));
});

test('the session start reads the usage through the script and a failed read hides it', async ($, on) => {
  const { codex: argvs, antigravity: antigravityArgvs } = answerProviders(
    on,
    ['not json'],
    ['not json'],
  );

  await startSession($);
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] });
  await settled();

  expect(argvs).toEqual([
    [
      'node',
      expect.stringMatching(
        /\/skills\/workflow\/engineering\/scripts\/codex-model\.mts$/,
      ),
      '--usage',
    ],
  ]);

  expect(antigravityArgvs).toEqual([
    [
      'node',
      expect.stringMatching(
        /\/skills\/workflow\/engineering\/scripts\/antigravity-model\.mts$/,
      ),
      '--usage',
    ],
  ]);

  expect(await drawn($)).toBe('1/3 · Write the parser');

  for (const surface of GRAPHICAL_SURFACES) {
    const { caption, codex } = await graphicalBand($, surface);

    expect({ caption, codex }).toEqual({ caption: null, codex: null });
  }
});

test('a window below the minimum draws the usage in the error color', async ($, on) => {
  answerEngine(on, LOW_USAGE);
  await startSession($);
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] });
  await settled();

  const ui = await $.ui.mount({
    plugin: 'forge',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: PROPS,
  });

  const codex = await ui.find({ type: 'Text', text: /^ +Codex/ });

  expect(codex?.text.trimStart()).toBe(
    'Codex 5h 12% · week 81% (below minimum)',
  );

  expect(codex?.props.color).toBe('error');

  for (const surface of GRAPHICAL_SURFACES) {
    expect((await graphicalBand($, surface)).codex).toEqual([
      { size: 'caption', dimColor: true, text: 'Codex' },
      { size: 'caption', tabular: true, color: 'error', text: '5h 12%' },
      { size: 'caption', dimColor: true, text: '·' },
      { size: 'caption', tabular: true, color: 'error', text: 'week 81%' },
      { size: 'caption', color: 'error', text: 'below minimum' },
    ]);
  }
});

test('a Codex call reads the usage again', async ($, on) => {
  const argvs = answerEngine(on, USAGE, LOW_USAGE);

  await startSession($);
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] });
  await $.tool.call({
    tool: 'Agent',
    description: 'review',
    prompt: '--wait',
    subagent_type: 'codex:codex-rescue',
  });

  await settled();
  expect(argvs.length).toBe(2);
  expect(await drawn($)).toBe(
    atEdge('1/3 · Write the parser', 'Codex 5h 12% · week 81% (below minimum)'),
  );
});

test('every prompt but a meta one reads the usage again and draws its answer', async ($, on) => {
  const argvs = answerEngine(on, USAGE, LOW_USAGE);

  await startSession($);
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] });
  await settled();
  expect(await drawn($)).toBe(
    atEdge('1/3 · Write the parser', 'Codex 5h 62% · week 81%'),
  );

  // The kit's typed call leaves out isMeta, which the engine passes for an idle notice or a delivery receipt.
  await $.prompt.submit({
    text: 'idle',
    wait: false,
    origin: { kind: 'composer' },
    isMeta: true,
  } as never);

  await settled();
  expect(argvs.length).toBe(1);

  await $.prompt.submit({
    text: 'done?',
    wait: false,
    origin: { kind: 'task-notification' },
  });

  await settled();
  expect(argvs.length).toBe(2);
  expect(await drawn($)).toBe(
    atEdge('1/3 · Write the parser', 'Codex 5h 12% · week 81% (below minimum)'),
  );
});

test('a survey holds the band and /clear ends the run but keeps the usage', async ($, on) => {
  answerEngine(on, USAGE);
  await startSession($);
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] });
  await settled();

  const survey = await $.ui.mount({
    plugin: 'forge',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...PROPS, hasSurvey: true },
  });

  expect((await survey.find({ type: 'Text' }))?.text).toBe('ENGINE');

  await $.session.end({
    reason: 'clear',
    sessionId: 's1',
    resume: { id: 's1' },
  });

  await settled();
  expect(await drawn($)).toBe(atEdge('', 'Codex 5h 62% · week 81%'));
});

test('the session start with no list draws the usage alone at the right edge and a prompt reads it again', async ($, on) => {
  answerEngine(on, USAGE, LOW_USAGE);
  await startSession($);
  await settled();
  expect(await drawn($)).toBe(atEdge('', 'Codex 5h 62% · week 81%'));

  await $.prompt.submit({
    text: 'next',
    wait: false,
    origin: { kind: 'composer' },
  });

  await settled();
  expect(await drawn($)).toBe(
    atEdge('', 'Codex 5h 12% · week 81% (below minimum)'),
  );
});

test('desktop and mobile draw the usage alone as a caption at the right end of the row', async ($, on) => {
  answerEngine(on, USAGE);
  await startSession($);
  await settled();

  for (const surface of GRAPHICAL_SURFACES) {
    const tree = await drawnTree($, surface);

    expect({
      row: tree.props,
      parts: elementsOf(tree).map(part => ({
        props: part.props,
        cells: elementsOf(part).map(cellOf),
      })),
    }).toEqual({
      row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 'sm',
      },
      parts: [
        {
          props: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 'xs',
            flexShrink: 0,
          },
          cells: [
            { size: 'caption', dimColor: true, text: 'Codex' },
            { size: 'caption', tabular: true, text: '5h 62%' },
            { size: 'caption', dimColor: true, text: '·' },
            { size: 'caption', tabular: true, text: 'week 81%' },
          ],
        },
      ],
    });
  }
});

test('no list and a failed read draw nothing on any surface', async ($, on) => {
  answerEngine(on, 'not json');
  await startSession($);
  await settled();

  expect(await drawn($)).toBe('ENGINE');

  for (const surface of GRAPHICAL_SURFACES) {
    expect(cellOf(await drawnTree($, surface)).text).toBe('ENGINE');
  }
});

test('the session start with a reading and no list draws the Claude usage alone at the left edge', async ($, on) => {
  answerSession(on, SESSION);
  answerEngine(on, 'not json');
  await startSession($);
  await settled();

  expect(await drawn($)).toBe('Claude 5h 77%');
});

test('the Claude usage comes first, then the progress and the Codex usage at the right edge', async ($, on) => {
  answerSession(on, SESSION);
  answerEngine(on, USAGE);
  await startSession($);
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] });
  await settled();

  expect(await drawn($)).toBe(
    atEdge('Claude 5h 77% · 1/3 · Write the parser', CODEX),
  );

  const ui = await $.ui.mount({
    plugin: 'forge',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: PROPS,
  });

  const claude = await ui.find({ type: 'Text', text: /^Claude 5h 77% · $/ });

  expect(claude?.props.dimColor).toBe(true);
});

test('a measurement draws its new reading, 0% past the window, and hides the usage without a 5-hour window', async ($, on) => {
  answerSession(on, SESSION);
  answerEngine(on, 'not json');
  await startSession($);
  await settled();
  expect(await drawn($)).toBe('Claude 5h 77%');

  await measure($, [{ kind: 'five_hour', percentUsed: 60 }]);
  expect(await drawn($)).toBe('Claude 5h 40%');

  await measure($, [{ kind: 'five_hour', percentUsed: 104.5 }]);
  expect(await drawn($)).toBe('Claude 5h 0%');

  await measure($, [{ kind: 'seven_day', percentUsed: 40 }]);
  expect(await drawn($)).toBe('ENGINE');
});

test('the session start with no reading draws no Claude usage', async ($, on) => {
  answerSession(on, []);
  answerEngine(on, USAGE);
  await startSession($);
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] });
  await settled();

  expect(await drawn($)).toBe(atEdge('1/3 · Write the parser', CODEX));
});

test('desktop and mobile draw the Claude caption first in the row', async ($, on) => {
  answerSession(on, SESSION);
  answerEngine(on, USAGE);
  await startSession($);
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] });
  await settled();

  for (const surface of GRAPHICAL_SURFACES) {
    const tree = await drawnTree($, surface);
    const [claude, ...rest] = elementsOf(tree);

    expect({
      row: tree.props,
      claude: claude?.props,
      cells: elementsOf(claude).map(cellOf),
      rest: rest.map(part => cellOf(part).text),
    }).toEqual({
      row: { flexDirection: 'row', alignItems: 'center', gap: 'sm' },
      claude: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 'xs',
        flexShrink: 0,
      },
      cells: [
        { size: 'caption', dimColor: true, text: 'Claude' },
        { size: 'caption', tabular: true, text: '5h 77%' },
      ],
      rest: ['1/3', 'Write the parser', 'Codex5h 62%·week 81%'],
    });
  }
});

test('desktop and mobile with no list draw the Claude caption at the left end and the Codex caption at the right end', async ($, on) => {
  answerSession(on, SESSION);
  answerEngine(on, USAGE);
  await startSession($);
  await settled();

  for (const surface of GRAPHICAL_SURFACES) {
    const tree = await drawnTree($, surface);

    expect({
      row: tree.props,
      parts: elementsOf(tree).map(part => cellOf(part).text),
    }).toEqual({
      row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 'sm',
      },
      parts: ['Claude5h 77%', 'Codex5h 62%·week 81%'],
    });
  }
});

test('both usages stand at the right edge, the Antigravity usage after the Codex usage', async ($, on) => {
  answerProviders(on, [USAGE], [AGY_USAGE]);
  await startSession($);
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] });
  await settled();

  expect(await drawn($)).toBe(atEdge('1/3 · Write the parser', CODEX, AGY));
});

test('the Antigravity usage alone stands at the right edge', async ($, on) => {
  answerProviders(on, ['not json'], [AGY_USAGE]);
  await startSession($);
  await settled();

  expect(await drawn($)).toBe(atEdge('', AGY));
});

test('several groups of the Antigravity usage are named by a short name', async ($, on) => {
  answerProviders(on, ['not json'], [AGY_GROUPS_USAGE]);
  await startSession($);
  await settled();

  expect(await drawn($)).toBe(atEdge('', 'Antigravity Gemini 91% · Argon 40%'));
});

test('a failed Antigravity read leaves the Codex usage as it is', async ($, on) => {
  answerProviders(on, [USAGE], [null]);
  await startSession($);
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] });
  await settled();

  expect(await drawn($)).toBe(atEdge('1/3 · Write the parser', CODEX));

  for (const surface of GRAPHICAL_SURFACES) {
    const tree = await drawnTree($, surface);
    const [, , codex, antigravity] = elementsOf(tree);

    expect({
      codex: cellOf(codex).text,
      antigravity: antigravity === undefined ? null : cellOf(antigravity).text,
    }).toEqual({ codex: 'Codex5h 62%·week 81%', antigravity: null });
  }
});

test('a failed Codex read leaves the Antigravity usage as it is', async ($, on) => {
  answerProviders(on, ['not json'], [AGY_USAGE]);
  await startSession($);
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] });
  await settled();

  expect(await drawn($)).toBe(atEdge('1/3 · Write the parser', AGY));
});

test('a limit below the minimum draws the Antigravity usage in the error color and leaves the Codex usage', async ($, on) => {
  answerProviders(on, [USAGE], [AGY_LOW_USAGE]);
  await startSession($);
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] });
  await settled();

  const ui = await $.ui.mount({
    plugin: 'forge',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: PROPS,
  });

  const codex = await ui.find({ type: 'Text', text: /^ +Codex/ });
  const antigravity = await ui.find({ type: 'Text', text: /^ +Antigravity/ });

  expect(antigravity?.text.trimStart()).toBe(
    'Antigravity week 12% (below minimum)',
  );

  expect(antigravity?.props.color).toBe('error');
  expect(codex?.props.color).toBeUndefined();

  for (const surface of GRAPHICAL_SURFACES) {
    const [, , , caption] = elementsOf(await drawnTree($, surface));

    expect(elementsOf(caption).map(cellOf)).toEqual([
      { size: 'caption', dimColor: true, text: 'Antigravity' },
      { size: 'caption', tabular: true, color: 'error', text: 'week 12%' },
      { size: 'caption', color: 'error', text: 'below minimum' },
    ]);
  }
});

test('an Antigravity call reads the Antigravity usage again and leaves the Codex read alone', async ($, on) => {
  const { codex: argvs, antigravity: antigravityArgvs } = answerProviders(
    on,
    [USAGE],
    [AGY_USAGE, AGY_LOW_USAGE],
  );

  await startSession($);
  await $.tool.call({
    tool: 'Agent',
    description: 'review',
    prompt: '--wait --model gemini-3.1-pro-high review the diff',
    subagent_type: 'antigravity:antigravity-rescue',
  });

  await settled();
  expect(antigravityArgvs.length).toBe(2);
  expect(argvs.length).toBe(1);
  expect(await drawn($)).toBe(
    atEdge('', CODEX, 'Antigravity week 12% (below minimum)'),
  );
});

test('a Codex call reads the Codex usage again and leaves the Antigravity read alone', async ($, on) => {
  const { codex: argvs, antigravity: antigravityArgvs } = answerProviders(
    on,
    [USAGE, LOW_USAGE],
    [AGY_USAGE],
  );

  await startSession($);
  await $.tool.call({
    tool: 'Agent',
    description: 'review',
    prompt: '--wait',
    subagent_type: 'codex:codex-rescue',
  });

  await settled();
  expect(argvs.length).toBe(2);
  expect(antigravityArgvs.length).toBe(1);
});

test('every prompt but a meta one reads the usage of both providers again', async ($, on) => {
  const { codex: argvs, antigravity: antigravityArgvs } = answerProviders(
    on,
    [USAGE, LOW_USAGE],
    [AGY_USAGE, AGY_LOW_USAGE],
  );

  await startSession($);
  await settled();
  expect(await drawn($)).toBe(atEdge('', CODEX, AGY));

  await $.prompt.submit({
    text: 'next',
    wait: false,
    origin: { kind: 'composer' },
  });

  await settled();
  expect(argvs.length).toBe(2);
  expect(antigravityArgvs.length).toBe(2);
  expect(await drawn($)).toBe(
    atEdge(
      '',
      'Codex 5h 12% · week 81% (below minimum)',
      'Antigravity week 12% (below minimum)',
    ),
  );
});

test('a slow Antigravity read never delays the Codex usage', async ($, on) => {
  answerProviders(on, [USAGE], [HANG]);
  await startSession($);
  await settled();

  expect(await drawn($)).toBe(atEdge('', CODEX));
});

test('a slow Codex read never delays the Antigravity usage', async ($, on) => {
  answerProviders(on, [HANG], [AGY_USAGE]);
  await startSession($);
  await settled();

  expect(await drawn($)).toBe(atEdge('', AGY));
});

test('desktop and mobile draw the Antigravity caption next to the Codex caption, built the same way', async ($, on) => {
  answerProviders(on, [USAGE], [AGY_USAGE]);
  await startSession($);
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] });
  await settled();

  for (const surface of GRAPHICAL_SURFACES) {
    const tree = await drawnTree($, surface);
    const [, , codex, antigravity] = elementsOf(tree);

    expect({
      row: tree.props,
      codex: { props: codex?.props, cells: elementsOf(codex).map(cellOf) },
      antigravity: {
        props: antigravity?.props,
        cells: elementsOf(antigravity).map(cellOf),
      },
    }).toEqual({
      row: { flexDirection: 'row', alignItems: 'center', gap: 'sm' },
      codex: {
        props: CAPTION,
        cells: [
          { size: 'caption', dimColor: true, text: 'Codex' },
          { size: 'caption', tabular: true, text: '5h 62%' },
          { size: 'caption', dimColor: true, text: '·' },
          { size: 'caption', tabular: true, text: 'week 81%' },
        ],
      },
      antigravity: {
        props: CAPTION,
        cells: [
          { size: 'caption', dimColor: true, text: 'Antigravity' },
          { size: 'caption', tabular: true, text: 'week 91%' },
        ],
      },
    });
  }
});

test('desktop and mobile with no list draw the Claude caption at the left end and both captions at the right end', async ($, on) => {
  answerSession(on, SESSION);
  answerProviders(on, [USAGE], [AGY_USAGE]);
  await startSession($);
  await settled();

  for (const surface of GRAPHICAL_SURFACES) {
    const tree = await drawnTree($, surface);
    const [claude, ...captions] = elementsOf(tree);

    expect({
      row: tree.props,
      claude: claude?.props,
      captions: captions.map(part => cellOf(part).text),
    }).toEqual({
      row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 'sm',
      },
      claude: { flexGrow: 1, minWidth: 0 },
      captions: ['Codex5h 62%·week 81%', 'Antigravityweek 91%'],
    });
  }
});

/** The props of a usage caption, a row of the label and the readings that never shrinks. */
const CAPTION = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 'xs',
  flexShrink: 0,
};

/** Answers the plugin's read of the session's usage with the given rate-limit windows. */
function answerSession(on: On, rateLimits: SessionRateLimit[]): void {
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits },
  }));
}

/** Raises the measurement the engine pushes after a turn with the given rate-limit windows and lets the redraw land. */
async function measure(
  $: Engine,
  rateLimits: SessionRateLimit[],
): Promise<void> {
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits,
    changed: ['rateLimits'],
  });

  await settled();
}

/** The next stdout a usage script prints, null for a script that fails and HANG for one that never ends. */
type Read = string | null | typeof HANG;

const HANG = Symbol('a read that never ends');

/** Answers as the engine beneath the plugin, the tools, the Codex usage script with the next of the given stdouts and the last one ever after, the Antigravity usage script with a failure, and the band with ENGINE, and returns the argv of every Codex run. */
function answerEngine(on: On, ...stdouts: [string, ...string[]]): string[][] {
  return answerProviders(on, stdouts, [null]).codex;
}

/** Answers as answerEngine does, with the next of the given reads for the Antigravity usage script too, and returns the argv of every run of each script. */
function answerProviders(
  on: On,
  codex: [Read, ...Read[]],
  antigravity: [Read, ...Read[]],
): { codex: string[][]; antigravity: string[][] } {
  const argvs: { codex: string[][]; antigravity: string[][] } = {
    codex: [],
    antigravity: [],
  };

  on('tool.call', { tool: 'TodoWrite' }, ($, e) => ({
    result: { oldTodos: [], newTodos: e.todos },
  }));

  on('tool.call', { tool: 'TaskCreate' }, ($, e) => ({
    result: { task: { id: '7', subject: e.subject } },
  }));

  on('tool.call', { tool: 'TaskUpdate' }, ($, e) => ({
    result: { success: true, taskId: e.taskId, updatedFields: ['status'] },
  }));

  on('tool.call', { tool: 'Agent' }, ($, e) => ({
    result: {
      status: 'async_launched',
      agentId: 'a7',
      description: e.description,
      prompt: e.prompt,
      outputFile: '/tmp/a7.output',
    },
  }));

  on('process.run', ($, e) => {
    const provider = isAntigravityRead(e.argv) ? 'antigravity' : 'codex';
    const reads = provider === 'codex' ? codex : antigravity;
    const read = reads[Math.min(argvs[provider].length, reads.length - 1)];

    argvs[provider].push([...e.argv]);

    return read === HANG ? new Promise<never>(() => {}) : finished(read);
  });

  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('prompt.submit', ($, e) => ({ text: e.text }));
  on('session.end', ($, e) => ({ sessionId: e.sessionId }));
  on('session.measure', ($, e) => ({ changed: e.changed }));
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e);

    return Text({ children: ['ENGINE'] });
  });

  return argvs;
}

/** Tells the run of the Antigravity usage script from any other process. */
function isAntigravityRead(argv: readonly string[]): boolean {
  return argv[1]?.endsWith('/antigravity-model.mts') === true;
}

/** Answers a process run that ended, with the stdout of a script that succeeded, or with the failure of a script when the stdout is null. */
function finished(stdout: string | null) {
  return {
    value: {
      exitCode: stdout === null ? 1 : 0,
      stdout: stdout ?? '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  };
}

/** Starts the session on the terminal, which reads the usage of each provider once. */
async function startSession($: Engine): Promise<void> {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true });
}

/** Writes the line the band draws at PROPS.bodyColumns, the given text on the left and the usages at the right edge with three columns between them. */
function atEdge(left: string, ...usages: string[]): string {
  const text = usages.join('   ');
  const pad = PROPS.bodyColumns - [...left].length - [...text].length;

  return `${left}${' '.repeat(pad)}${text}`;
}

/** Mounts the band on the terminal and returns the text it draws, ENGINE when the plugin passed. */
async function drawn($: Engine): Promise<string | undefined> {
  const ui = await $.ui.mount({
    plugin: 'forge',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: PROPS,
  });

  const text = (await ui.find({ type: 'Text' }))?.text;

  await ui.unmount();

  return text;
}

/** An element of a drawn tree as plain data, the kit's `drawn()` answer. */
type Drawn = {
  type: string;
  props?: Record<string, unknown>;
  children?: (Drawn | string)[];
};

/** An element with its own props and those of everything inside it in one record, and the text it shows. */
type Cell = Record<string, unknown> & { text: string };

/** Mounts the band on the surface and returns the props of each box of the row and the cells of the count, the title and the Codex caption, null where the row has no caption. */
async function graphicalBand(
  $: Engine,
  surface: (typeof GRAPHICAL_SURFACES)[number],
) {
  const tree = await drawnTree($, surface);
  const [progress, title, caption] = elementsOf(tree);
  const [count, track] = elementsOf(progress);
  const [fill] = elementsOf(track);

  return {
    row: tree.props,
    progress: progress?.props,
    count: cellOf(count),
    track: track?.props,
    fill: fill?.props,
    title: cellOf(title),
    caption: caption?.props ?? null,
    codex: caption === undefined ? null : elementsOf(caption).map(cellOf),
  };
}

/** Mounts the band on the surface and returns the tree it draws. */
async function drawnTree(
  $: Engine,
  surface: (typeof GRAPHICAL_SURFACES)[number],
): Promise<Drawn> {
  const ui = await $.ui.mount({
    plugin: 'forge',
    surface,
    component: 'AbovePrompt',
    props: PROPS,
  });

  const tree = (await ui.drawn()) as Drawn;

  await ui.unmount();

  return tree;
}

function elementsOf(element: Drawn | undefined): Drawn[] {
  return (element?.children ?? []).filter(
    (child): child is Drawn => typeof child !== 'string',
  );
}

/** Merges the props of the element and of everything inside it and joins the strings it shows. */
function cellOf(element: Drawn | undefined): Cell {
  const inner = elementsOf(element).map(cellOf);
  const strings = (element?.children ?? []).filter(
    (child): child is string => typeof child === 'string',
  );

  return Object.assign({}, element?.props, ...inner, {
    text: [...strings, ...inner.map(cell => cell.text)].join(''),
  });
}

/** Lets the work a hook left running, the run write and the usage read, land before an assertion. */
function settled(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 100));
}

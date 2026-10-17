// Drives the review order module of this plugin through the engine's own events and reads the pane it draws.
// https://code.claude.com/docs/en/plugins/mods/reference.md

import type { On } from 'claude-code';
import { expect, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';

/** Declares the timer the test environment has and the engine's declarations leave out. */
declare function setTimeout(callback: () => void, ms: number): unknown;

const SURFACES = ['terminal', 'desktop'] as const;

const GRAPHICAL_SURFACES = ['desktop', 'mobile'] as const;

const PROPS = {
  title: 'Review queue · r',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
} as const;

/** The answer `gh api graphql` gives for three open pull requests, the stack's top created first and the draft in between. */
const THREE_PULL_REQUESTS = ghAnswer([
  node(11, 'Middle of the stack', {
    createdAt: '2026-01-01T10:00:00Z',
    head: 'middle',
    base: 'bottom',
  }),
  node(12, 'Docs\nfor the stack', {
    createdAt: '2026-02-01T10:00:00Z',
    isDraft: true,
  }),
  node(10, 'Bottom of the stack', {
    createdAt: '2026-03-01T10:00:00Z',
    head: 'bottom',
  }),
]);

const ONE_PULL_REQUEST = ghAnswer([
  node(5, 'The only one', { createdAt: '2026-01-01T10:00:00Z' }),
]);

const NO_PULL_REQUESTS = ghAnswer([]);

/** A stack of three with a draft on top, and a ready pull request on its own created last. */
const STACK_OF_THREE = ghAnswer([
  node(10, 'Bottom of the stack', {
    createdAt: '2026-01-01T10:00:00Z',
    head: 'bottom',
  }),
  node(11, 'Middle of the stack', {
    createdAt: '2026-02-01T10:00:00Z',
    head: 'middle',
    base: 'bottom',
  }),
  node(13, 'Top of the stack', {
    createdAt: '2026-03-01T10:00:00Z',
    base: 'middle',
    isDraft: true,
  }),
  node(12, 'On its own', { createdAt: '2026-04-01T10:00:00Z' }),
]);

const TEN_PULL_REQUESTS = ghAnswer(
  Array.from({ length: 10 }, (_, index) =>
    node(index + 1, `Pull request ${index + 1}`, {
      createdAt: `2026-01-${String(index + 1).padStart(2, '0')}T10:00:00Z`,
    }),
  ),
);

test('the session start opens the pane and draws the pull requests in the order to review them', async ($, on) => {
  const engine = answerEngine(on, THREE_PULL_REQUESTS);

  await startSession($);

  expect(engine.argvs).toEqual([
    [
      'gh',
      'api',
      'graphql',
      '-F',
      'owner={owner}',
      '-F',
      'name={repo}',
      '-f',
      expect.stringMatching(
        /^query=query\(\$owner: String!, \$name: String!\)/,
      ),
    ],
  ]);

  expect(engine.panes).toEqual(['open review-queue Review queue · r']);
  expect(engine.commands).toEqual(['review-queue']);

  expect(await header($, 'terminal')).toEqual({
    line: 'o/r · 3 open',
    bold: ['o/r'],
    href: 'https://github.com/o/r/pulls',
  });

  expect(await rows($, 'terminal')).toEqual([
    '1. #10 Bottom of the stack',
    '2.   #11 Middle of the stack after #10',
    '3. #12 Docs for the stack draft',
  ]);

  for (const surface of SURFACES) {
    expect(await links($, surface)).toEqual([
      'https://github.com/o/r/pulls',
      'https://github.com/o/r/pull/10',
      'https://github.com/o/r/pull/11',
      'https://github.com/o/r/pull/12',
    ]);
  }
});

test('the header is cut to the width of the pane and the count stays', async ($, on) => {
  answerEngine(on, THREE_PULL_REQUESTS);
  await startSession($);

  const ui = await $.ui.mount({
    plugin: 'forge',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'review-queue',
    props: { ...PROPS, bodyColumns: 11 },
  });

  // The first match is the whole row, the dim count nested in it matches too.
  const [line] = await ui.findAll({ type: 'Text', text: / open$/ });

  await ui.unmount();

  expect(line?.text).toBe('o… · 3 open');
});

test('a row is cut to the width of the pane after the indent and the notes stay', async ($, on) => {
  answerEngine(on, THREE_PULL_REQUESTS);
  await startSession($);

  const ui = await $.ui.mount({
    plugin: 'forge',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'review-queue',
    props: { ...PROPS, bodyColumns: 24 },
  });

  const texts = await ui.findAll({ type: 'Text', text: /^\d+\. +#/ });

  await ui.unmount();

  expect(texts.map(text => text.text)).toEqual([
    '1. #10 Bottom of the st…',
    '2.   #11 Midd… after #10',
    '3. #12 Docs for t… draft',
  ]);
});

test('desktop and mobile draw the repository as a heading, a caption and one hoverable row per pull request with its stack guides', async ($, on) => {
  answerEngine(on, STACK_OF_THREE);
  await startSession($);

  for (const surface of GRAPHICAL_SURFACES) {
    const pane = await graphicalPane($, surface);

    expect(pane.header).toEqual([
      {
        size: 'heading',
        weight: 'semibold',
        bold: true,
        wrap: 'truncate-end',
        href: 'https://github.com/o/r/pulls',
        label: 'o/r',
        text: 'o/r',
      },
      { size: 'caption', dimColor: true, text: '4 open · top to bottom' },
    ]);

    expect(pane.rows).toEqual([
      {
        key: 'pr-10',
        hover: { backgroundColor: 'subtle' },
        cells: [
          position(1, 1),
          { color: 'success', text: '●' },
          title(10, 'Bottom of the stack'),
          { size: 'footnote', tabular: true, dimColor: true, text: '#10' },
        ],
      },
      {
        key: 'pr-11',
        hover: { backgroundColor: 'subtle' },
        cells: [
          position(2, 1),
          GUIDE,
          { color: 'success', text: '●' },
          title(11, 'Middle of the stack'),
          { size: 'footnote', tabular: true, dimColor: true, text: '#11' },
        ],
      },
      {
        key: 'pr-13',
        hover: { backgroundColor: 'subtle' },
        cells: [
          position(3, 1),
          GUIDE,
          GUIDE,
          { color: 'inactive', text: '○' },
          title(13, 'Top of the stack'),
          { size: 'caption', dimColor: true, text: 'Draft' },
          { size: 'footnote', tabular: true, dimColor: true, text: '#13' },
        ],
      },
      {
        key: 'pr-12',
        hover: { backgroundColor: 'subtle' },
        cells: [
          position(4, 1),
          { color: 'success', text: '●' },
          title(12, 'On its own'),
          { size: 'footnote', tabular: true, dimColor: true, text: '#12' },
        ],
      },
    ]);
  }
});

test('desktop widens the position column to the digits of the last position', async ($, on) => {
  answerEngine(on, TEN_PULL_REQUESTS);
  await startSession($);

  const { rows } = await graphicalPane($, 'desktop');

  expect(rows.map(row => row.cells[0])).toEqual(
    Array.from({ length: 10 }, (_, index) => position(index + 1, 2)),
  );
});

test('no open pull request leaves the pane closed', async ($, on) => {
  const engine = answerEngine(on, NO_PULL_REQUESTS);

  await startSession($);

  expect(engine.panes).toEqual(['close review-queue']);
});

test('gh failing draws no pane and shows no error', async ($, on) => {
  const engine = answerEngine(on, 'gh: not a git repository', 1);

  await startSession($);

  expect(engine.panes).toEqual(['close review-queue']);
});

test('gh failing after an answer draws neither the repository nor its pull requests', async ($, on) => {
  const engine = answerEngine(on, ONE_PULL_REQUEST);

  await startSession($);

  expect(await rows($, 'terminal')).toEqual(['1. #5 The only one']);

  engine.answer.exitCode = 1;
  await submit($, { kind: 'composer' });

  expect(engine.panes).toEqual([
    'open review-queue Review queue · r',
    'close review-queue',
  ]);

  expect(await links($, 'terminal')).toEqual([]);
});

test('the prompt of a person lists again and a task notification does not', async ($, on) => {
  const engine = answerEngine(on, NO_PULL_REQUESTS);

  await startSession($);

  engine.answer.stdout = ONE_PULL_REQUEST;
  await submit($, { kind: 'task-notification' });

  expect(engine.argvs.length).toBe(1);

  await submit($, { kind: 'composer' });

  expect(engine.argvs.length).toBe(2);
  expect(engine.panes).toEqual([
    'close review-queue',
    'open review-queue Review queue · r',
  ]);

  expect(await rows($, 'terminal')).toEqual(['1. #5 The only one']);
});

test('a gh pr call of the main loop or a subagent lists again and other calls do not', async ($, on) => {
  const engine = answerEngine(on, NO_PULL_REQUESTS);

  await startSession($);

  engine.answer.stdout = ONE_PULL_REQUEST;
  await $.tool.call({ tool: 'Bash', command: 'git status' });
  await settled();

  expect(engine.argvs.length).toBe(1);

  await $.tool.call({ tool: 'Bash', command: 'gh pr create --draft' });
  await settled();

  expect(engine.argvs.length).toBe(2);
  expect(engine.panes).toEqual([
    'close review-queue',
    'open review-queue Review queue · r',
  ]);

  // The kit's typed call leaves out agentId, which the engine still passes to the plugin as a subagent's loop.
  await $.tool.call({
    tool: 'Bash',
    command: 'gh pr merge 5 --squash',
    agentId: 'a1',
  } as never);

  await settled();

  expect(engine.argvs.length).toBe(3);
});

test('a gh pr call that fails lists nothing again', async ($, on) => {
  // The test's hooks nest in the order they are registered, so this answer stands before answerEngine's.
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: '', stderr: 'boom', interrupted: false },
    isError: true,
  }));

  const engine = answerEngine(on, NO_PULL_REQUESTS);

  await startSession($);

  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 5' });
  await settled();

  expect(engine.argvs.length).toBe(1);
});

test('the review-queue command lists again, opens the pane and says so', async ($, on) => {
  const engine = answerEngine(on, NO_PULL_REQUESTS);

  await startSession($);

  const none = await runCommand($);

  expect(none.text).toBe('No open pull requests.');

  engine.answer.stdout = ONE_PULL_REQUEST;

  const some = await runCommand($);

  expect(some.text).toBe('Review queue pane opened.');
  expect(engine.argvs.length).toBe(3);
  expect(engine.panes).toEqual([
    'close review-queue',
    'close review-queue',
    'open review-queue Review queue · r',
  ]);
});

/** What the engine's `process.run` answers, changed by a test between calls. */
type Answer = { stdout: string; exitCode: number };

/** Answers as the engine beneath the plugin, `gh` with the answer, the commands, the panes and the tools, and returns what the plugin asked for. */
function answerEngine(on: On, stdout: string, exitCode = 0) {
  const argvs: string[][] = [];
  const panes: string[] = [];
  const commands: string[] = [];
  const answer: Answer = { stdout, exitCode };

  on('session.start', ($, e) => ({ cwd: e.cwd }));

  on('command.register', ($, e) => {
    commands.push(e.name);

    return { value: { command: e.name } };
  });

  on('command.run', ($, e) => ({ text: `engine ${e.command}` }));

  on('process.run', ($, e) => {
    argvs.push([...e.argv]);

    return {
      value: {
        exitCode: answer.exitCode,
        stdout: answer.stdout,
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });

  on('ui.open', ($, e) => {
    panes.push(`open ${e.id} ${e.title}`);

    return { value: { isPlaced: true } };
  });

  on('ui.close', ($, e) => {
    panes.push(`close ${e.id}`);

    return { value: undefined };
  });

  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: '', stderr: '', interrupted: false },
  }));

  on('prompt.submit', ($, e) => ({ text: e.text }));

  return { argvs, panes, commands, answer };
}

/** Starts the session on the terminal and lets the refresh it started land. */
async function startSession($: Engine): Promise<void> {
  await $.session.start({
    cwd: '/work/repo',
    surface: 'terminal',
    isInteractive: true,
  });

  await settled();
}

/** Types /review-queue at the prompt of the terminal. */
function runCommand($: Engine) {
  return $.command.run({
    command: 'review-queue',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  });
}

/** Submits a prompt of the given origin and lets the refresh it started land. */
async function submit(
  $: Engine,
  origin: { kind: 'composer' } | { kind: 'task-notification' },
): Promise<void> {
  await $.prompt.submit({ text: 'next', wait: false, origin });
  await settled();
}

/** Mounts the pane on the surface and returns the text of each row. */
async function rows(
  $: Engine,
  surface: (typeof SURFACES)[number],
): Promise<string[]> {
  const ui = await $.ui.mount({
    plugin: 'forge',
    surface,
    component: 'Pane',
    requestId: 'review-queue',
    props: PROPS,
  });

  const texts = await ui.findAll({ type: 'Text', text: /^\d+\. +#/ });

  await ui.unmount();

  return texts.map(text => text.text);
}

/** Mounts the pane on the surface and returns the text of the header row, the bold parts of it and where its link goes. */
async function header(
  $: Engine,
  surface: (typeof SURFACES)[number],
): Promise<{ line: string | undefined; bold: string[]; href: unknown }> {
  const ui = await $.ui.mount({
    plugin: 'forge',
    surface,
    component: 'Pane',
    requestId: 'review-queue',
    props: PROPS,
  });

  const [line] = await ui.findAll({ type: 'Text', text: / open$/ });
  const texts = await ui.findAll({ type: 'Text' });
  const [link] = await ui.findAll({ type: 'Link' });

  await ui.unmount();

  return {
    line: line?.text,
    bold: texts
      .filter(text => text.props.weight === 'bold')
      .map(text => text.text),
    href: link?.props.href,
  };
}

/** Mounts the pane on the surface and returns where each link goes. */
async function links(
  $: Engine,
  surface: (typeof SURFACES)[number],
): Promise<unknown[]> {
  const ui = await $.ui.mount({
    plugin: 'forge',
    surface,
    component: 'Pane',
    requestId: 'review-queue',
    props: PROPS,
  });

  const found = await ui.findAll({ type: 'Link' });

  await ui.unmount();

  return found.map(link => link.props.href);
}

/** An element of a drawn tree as plain data, the kit's `drawn()` answer. */
type Drawn = {
  type: string;
  props?: Record<string, unknown>;
  hover?: unknown;
  children?: (Drawn | string)[];
};

/** A cell of a row with its own props and those of everything inside it in one record, and the text it shows. */
type Cell = Record<string, unknown> & { text: string };

const GUIDE: Cell = { color: 'inactive', text: '│' };

/** Mounts the pane on the surface and returns the cells of the header and, per row, its key, its hover and its cells. */
async function graphicalPane(
  $: Engine,
  surface: (typeof GRAPHICAL_SURFACES)[number],
): Promise<{
  header: Cell[];
  rows: { key: unknown; hover: unknown; cells: Cell[] }[];
}> {
  const ui = await $.ui.mount({
    plugin: 'forge',
    surface,
    component: 'Pane',
    requestId: 'review-queue',
    props: PROPS,
  });

  const tree = (await ui.drawn()) as Drawn;

  await ui.unmount();

  const [header, list] = elementsOf(tree);

  return {
    header: elementsOf(header).map(cellOf),
    rows: elementsOf(list).map(row => ({
      key: row.props?.key,
      hover: row.hover,
      cells: elementsOf(row).map(cellOf),
    })),
  };
}

function elementsOf(element: Drawn | undefined): Drawn[] {
  return (element?.children ?? []).filter(
    (child): child is Drawn => typeof child !== 'string',
  );
}

/** Merges the props of the element and of everything inside it and joins the strings and link labels it shows. */
function cellOf(element: Drawn): Cell {
  const inner = elementsOf(element).map(cellOf);
  const strings = (element.children ?? []).filter(
    (child): child is string => typeof child === 'string',
  );

  const label =
    element.type === 'Link' && typeof element.props?.label === 'string'
      ? [element.props.label]
      : [];

  return Object.assign({}, element.props, ...inner, {
    text: [...strings, ...label, ...inner.map(cell => cell.text)].join(''),
  });
}

/** The position cell of a row, its Box as wide as the given columns. */
function position(at: number, width: number): Cell {
  return {
    width,
    flexShrink: 0,
    justifyContent: 'flex-end',
    tabular: true,
    dimColor: true,
    text: `${at}`,
  };
}

/** The title cell of a row, a link to the pull request that takes the free width. */
function title(number: number, label: string): Cell {
  return {
    flexGrow: 1,
    minWidth: 0,
    wrap: 'truncate-end',
    href: `https://github.com/o/r/pull/${number}`,
    label,
    text: label,
  };
}

/** Lets the work a hook left running, the list and the pane, land before an assertion. */
function settled(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 100));
}

/** Builds one node of the answer the way `gh api graphql` prints it. */
function node(
  number: number,
  title: string,
  fields: {
    createdAt: string;
    head?: string;
    base?: string;
    isDraft?: boolean;
  },
) {
  return {
    number,
    title,
    url: `https://github.com/o/r/pull/${number}`,
    isDraft: fields.isDraft ?? false,
    createdAt: fields.createdAt,
    headRefName: fields.head ?? `branch-${number}`,
    baseRefName: fields.base ?? 'main',
    closingIssuesReferences: { nodes: [] },
  };
}

/** Wraps nodes into the one line `gh api graphql` prints for the repository `o/r`. */
function ghAnswer(nodes: ReturnType<typeof node>[]): string {
  return JSON.stringify({
    data: {
      repository: {
        nameWithOwner: 'o/r',
        url: 'https://github.com/o/r',
        pullRequests: { nodes },
      },
    },
  });
}

// Drives the hooks module of this plugin through the engine's own events and reads the line it draws above the prompt.
// https://code.claude.com/docs/en/plugins/mods/reference.md

import type { On } from 'claude-code';
import { expect, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';

/** Declares the timer the test environment has and the engine's declarations leave out. */
declare function setTimeout(callback: () => void, ms: number): unknown;

const SURFACES = ['terminal', 'desktop'] as const;

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

test('a TodoWrite of the main loop draws the count and the item in progress', async ($, on) => {
  answerEngine(on, USAGE);
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] });
  await settled();

  for (const surface of SURFACES) {
    expect(await drawn($, surface)).toBe(
      atEdge('1/3 · Write the parser', 'Codex 5h 62% · week 81%'),
    );
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

  expect(await drawn($, 'terminal')).toBe('ENGINE');
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

  expect(await drawn($, 'terminal')).toBe('ENGINE');
});

test('a task takes its id from the result and done ends on the person prompt only', async ($, on) => {
  answerEngine(on, USAGE);
  await $.tool.call({
    tool: 'TaskCreate',
    subject: 'Write the parser',
    description: '',
  });

  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'completed' });
  await settled();
  expect(await drawn($, 'terminal')).toBe(
    atEdge('1/1 done', 'Codex 5h 62% · week 81%'),
  );

  await $.prompt.submit({
    text: 'done?',
    wait: false,
    origin: { kind: 'task-notification' },
  });

  await settled();
  expect(await drawn($, 'terminal')).toBe(
    atEdge('1/1 done', 'Codex 5h 62% · week 81%'),
  );

  await $.prompt.submit({
    text: 'next',
    wait: false,
    origin: { kind: 'composer' },
  });

  await settled();
  expect(await drawn($, 'terminal')).toBe('ENGINE');
});

test('a meta prompt keeps done on the band', async ($, on) => {
  answerEngine(on, USAGE);
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
  expect(await drawn($, 'terminal')).toBe(
    atEdge('1/1 done', 'Codex 5h 62% · week 81%'),
  );
});

test('a run start reads the usage through the script and a failed read hides it', async ($, on) => {
  const argvs = answerEngine(on, 'not json');

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

  expect(await drawn($, 'terminal')).toBe('1/3 · Write the parser');
});

test('a window below the minimum draws the usage in the error color', async ($, on) => {
  answerEngine(on, '{"primary":12,"secondary":81,"belowMinimum":true}\n');
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
});

test('a Codex call reads the usage again', async ($, on) => {
  const argvs = answerEngine(on, USAGE);

  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] });
  await $.tool.call({
    tool: 'Agent',
    description: 'review',
    prompt: '--wait',
    subagent_type: 'codex:codex-rescue',
  });

  await settled();
  expect(argvs.length).toBe(2);
});

test('a survey holds the band and /clear ends the run', async ($, on) => {
  answerEngine(on, USAGE);
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
  expect(await drawn($, 'terminal')).toBe('ENGINE');
});

/** Answers as the engine beneath the plugin, the tools, the usage script with the given stdout, and the band with ENGINE, and returns the argv of every run. */
function answerEngine(on: On, stdout: string): string[][] {
  const argvs: string[][] = [];

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
    argvs.push([...e.argv]);

    return {
      value: {
        exitCode: 0,
        stdout,
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });

  on('prompt.submit', ($, e) => ({ text: e.text }));
  on('session.end', ($, e) => ({ sessionId: e.sessionId }));
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e);

    return Text({ children: ['ENGINE'] });
  });

  return argvs;
}

/** Writes the line the band draws at PROPS.bodyColumns, the progress on the left and the Codex text at the right edge. */
function atEdge(progress: string, codex: string): string {
  const pad = PROPS.bodyColumns - [...progress].length - [...codex].length;

  return `${progress}${' '.repeat(pad)}${codex}`;
}

/** Mounts the band on the surface and returns the text it draws, ENGINE when the plugin passed. */
async function drawn(
  $: Engine,
  surface: (typeof SURFACES)[number],
): Promise<string | undefined> {
  const ui = await $.ui.mount({
    plugin: 'forge',
    surface,
    component: 'AbovePrompt',
    props: PROPS,
  });

  const text = (await ui.find({ type: 'Text' }))?.text;

  await ui.unmount();

  return text;
}

/** Lets the work a hook left running, the run write and the usage read, land before an assertion. */
function settled(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 100));
}

// Drives the prompt optimizer of this plugin through the engine's own events, with the prompt box and the model answered by the test, and reads the trigger it draws above the prompt.
// https://code.claude.com/docs/en/plugins/mods/reference.md

import type {
  ModelForkResult,
  On,
  PromptEditInput,
  PromptEditResult,
} from 'claude-code';
import { expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';

import { OPTIMIZER_SYSTEM } from '../hooks/prompt-optimizer/optimizer-prompt.mts';

const BAND = {
  plugin: 'forge',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 5,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 5 },
    view: {},
  },
} as const;

const USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

const FRAMED_DRAFT = /<draft id="([^"]+)">\n([\s\S]*)\n<\/draft id="\1">$/;

test('the band hides on an empty idle box and shows once a draft is typed', async ($, on) => {
  const { world } = standInForEngine(on, () => answered('unused'));
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' });

  expect(await ui.find({ type: 'Button' })).toBeUndefined();

  await typeDraft($, world, 'fix bug');

  expect((await ui.find({ key: 'trigger' }))?.props.label).toBe(
    'Optimize prompt',
  );

  await typeDraft($, world, '');

  expect(await ui.find({ type: 'Button' })).toBeUndefined();
  await ui.unmount();
});

test('a draft is replaced by the rewrite the model returns', async ($, on) => {
  const { world } = standInForEngine(on, () =>
    answered('Fix the failing login test.'),
  );

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' });

  await typeDraft($, world, 'fix bug');

  await ui.press({ key: 'trigger' });

  expect(world.draft).toBe('Fix the failing login test.');
  expect(world.forkPrompts.map(draftIn)).toEqual(['fix bug']);
  expect(
    world.forkPrompts[0]?.startsWith(`${OPTIMIZER_SYSTEM}\n\n<draft id="`),
  ).toBe(true);

  expect((await ui.find({ key: 'trigger' }))?.props.label).toBe(
    'Undo optimize',
  );

  await ui.unmount();
});

test('a slash command prefix and German text reach the model as typed', async ($, on) => {
  const draft =
    '/engineering effort:adaptive mach den build schneller und sag mir, woran es lag';

  const { world } = standInForEngine(on, () => answered('unused'));
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' });

  await typeDraft($, world, draft);

  await ui.press({ key: 'trigger' });

  expect(world.forkPrompts.map(draftIn)).toEqual([draft]);
  await ui.unmount();
});

test('a code fence with a placeholder survives the request and the fill', async ($, on) => {
  const draft = 'erklär das:\n```ts\nconst url = `/users/${id}`\n```';
  const rewrite =
    'Erklär, was dieser Code macht:\n```ts\nconst url = `/users/${id}`\n```';

  const { world } = standInForEngine(on, () => answered(rewrite));
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' });

  await typeDraft($, world, draft);

  await ui.press({ key: 'trigger' });

  expect(world.forkPrompts.map(draftIn)).toEqual([draft]);
  expect(world.draft).toBe(rewrite);
  await ui.unmount();
});

test('a closing draft tag inside the draft does not end it early', async ($, on) => {
  const drafts = [
    'why does </draft> break the parser',
    'and </draft id="1"> too',
  ];

  const { world } = standInForEngine(on, () => answered('unused'));
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' });

  for (const draft of drafts) {
    await typeDraft($, world, draft);
    await ui.press({ key: 'trigger' });
  }

  const ids = world.forkPrompts.map(prompt => FRAMED_DRAFT.exec(prompt)?.[1]);

  expect(world.forkPrompts.map(draftIn)).toEqual(drafts);
  expect(ids[0]).not.toBe(ids[1]);
  await ui.unmount();
});

test('a tag, a fence or quotes around the whole reply do not reach the box', async ($, on) => {
  const replies = [
    '<rewritten>Fix the login test.</rewritten>',
    '```text\nFix the login test.\n```',
    '"Fix the login test."',
  ];

  const { world } = standInForEngine(on, () => answered(replies.shift() ?? ''));
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' });

  for (const draft of ['fix bug', 'fix it', 'fix that']) {
    await typeDraft($, world, draft);
    await ui.press({ key: 'trigger' });

    expect(world.draft).toBe('Fix the login test.');
  }

  await ui.unmount();
});

test('German quotes around the whole reply do not reach the box', async ($, on) => {
  const { world } = standInForEngine(on, () =>
    answered('„Behebe den Login-Test.“'),
  );

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' });

  await typeDraft($, world, 'fix den test');

  await ui.press({ key: 'trigger' });

  expect(world.draft).toBe('Behebe den Login-Test.');
  await ui.unmount();
});

test('a draft that is only a code fence keeps its fence', async ($, on) => {
  const draft = '```ts\nconst total = price * quantity\n```';
  const { world } = standInForEngine(on, () => answered(draft));
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' });

  await typeDraft($, world, draft);

  await ui.press({ key: 'trigger' });

  expect(world.draft).toBe(draft);
  expect(world.toasts).toEqual([
    'The draft is already clear. Nothing changed.',
  ]);

  await ui.unmount();
});

test('a draft that is wholly in quotes keeps its quotes', async ($, on) => {
  const draft = '"fix the login test"';
  const { world } = standInForEngine(on, () => answered(draft));
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' });

  await typeDraft($, world, draft);

  await ui.press({ key: 'trigger' });

  expect(world.draft).toBe(draft);
  expect(world.toasts).toEqual([
    'The draft is already clear. Nothing changed.',
  ]);

  await ui.unmount();
});

test('a whitespace draft stays untouched and asks no model', async ($, on) => {
  const { world } = standInForEngine(on, () => answered('unused'));
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' });

  await typeDraft($, world, '   ');

  await ui.press({ key: 'trigger' });

  expect(world.draft).toBe('   ');
  expect(world.forkPrompts).toEqual([]);
  expect(world.toasts).toEqual([
    'Nothing to optimize. The prompt box is empty.',
  ]);

  await ui.unmount();
});

test('an edit made while optimizing is not overwritten', async ($, on) => {
  const { reply, release } = heldReply();
  const { world, clock } = standInForEngine(on, () => reply);
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' });

  await typeDraft($, world, 'fix bug');

  const pressed = ui.press({ key: 'trigger' });

  await clock.settle();
  await typeDraft($, world, 'fix bug in the login form');
  release(answered('Fix the failing login test.'));
  await pressed;

  expect(world.draft).toBe('fix bug in the login form');
  expect(world.toasts).toEqual([
    'The draft changed while optimizing. The rewrite was dropped.',
  ]);

  expect((await ui.find({ key: 'trigger' }))?.props.label).toBe(
    'Optimize prompt',
  );

  await ui.unmount();
});

test('the trigger cancels a running optimization and keeps the draft', async ($, on) => {
  const { reply, release } = heldReply();
  const { world, clock } = standInForEngine(on, () => reply);
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' });

  await typeDraft($, world, 'fix bug');

  const pressed = ui.press({ key: 'trigger' });

  await clock.settle();

  expect((await ui.find({ key: 'trigger' }))?.props.label).toBe('Cancel');

  await ui.press({ key: 'trigger' });
  release(answered('Fix the failing login test.'));
  await pressed;

  expect(world.draft).toBe('fix bug');
  expect(world.toasts).toEqual([]);
  expect((await ui.find({ key: 'trigger' }))?.props.label).toBe(
    'Optimize prompt',
  );

  await ui.unmount();
});

test('the trigger on the rewritten draft restores the original', async ($, on) => {
  const { world } = standInForEngine(on, () =>
    answered('Fix the failing login test.'),
  );

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' });

  await typeDraft($, world, 'fix bug');
  await ui.press({ key: 'trigger' });

  await ui.press({ key: 'trigger' });

  expect(world.draft).toBe('fix bug');
  expect(world.forkPrompts).toHaveLength(1);
  expect((await ui.find({ key: 'trigger' }))?.props.label).toBe(
    'Optimize prompt',
  );

  await ui.unmount();
});

test('an edit of the rewritten draft ends undo and optimizes afresh', async ($, on) => {
  const replies = [
    'Fix the failing login test.',
    'Fix the failing login test and add a regression test.',
  ];

  const { world } = standInForEngine(on, () => answered(replies.shift() ?? ''));
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' });

  await typeDraft($, world, 'fix bug');
  await ui.press({ key: 'trigger' });

  await typeDraft($, world, 'Fix the failing login test, add test');

  expect((await ui.find({ key: 'trigger' }))?.props.label).toBe(
    'Optimize prompt',
  );

  await ui.press({ key: 'trigger' });

  expect(world.draft).toBe(
    'Fix the failing login test and add a regression test.',
  );

  await ui.unmount();
});

test('a submitted prompt ends undo', async ($, on) => {
  const { world } = standInForEngine(on, () =>
    answered('Fix the failing login test.'),
  );

  on('prompt.submit', (_, e) => ({ text: e.text }));

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' });

  await typeDraft($, world, 'fix bug');
  await ui.press({ key: 'trigger' });

  expect((await ui.find({ key: 'trigger' }))?.props.label).toBe(
    'Undo optimize',
  );

  await $.prompt.submit({
    text: world.draft,
    wait: false,
    origin: { kind: 'composer' },
  });

  expect((await ui.find({ key: 'trigger' }))?.props.label).toBe(
    'Optimize prompt',
  );

  await ui.unmount();
});

test('a session with nothing to fork asks the fallback model', async ($, on) => {
  const { world } = standInForEngine(on, () => ({
    isAnswered: false,
    reason: 'nothing-to-fork',
  }));

  const requests: unknown[] = [];

  on('model.complete', (_, e) => {
    requests.push({
      model: e.model,
      system: e.system,
      draft: draftIn(e.prompt),
    });

    return { value: answered('Fix the failing login test.') };
  });

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' });

  await typeDraft($, world, 'fix bug');

  await ui.press({ key: 'trigger' });

  expect(world.draft).toBe('Fix the failing login test.');
  expect(requests).toEqual([
    { model: 'sonnet', system: OPTIMIZER_SYSTEM, draft: 'fix bug' },
  ]);

  await ui.unmount();
});

test('a failed call shows its reason, keeps the draft, then clears', async ($, on) => {
  const { world, clock } = standInForEngine(on, () => ({
    isAnswered: false,
    reason: 'api-error',
    status: 429,
    error: 'rate_limit',
    usage: USAGE,
  }));

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' });

  await typeDraft($, world, 'fix bug');

  await ui.press({ key: 'trigger' });

  expect(world.draft).toBe('fix bug');
  expect((await ui.find({ type: 'Text' }))?.text).toBe(
    'failed: the API answered with rate_limit',
  );

  await clock.advance(6000);

  expect(await ui.find({ type: 'Text' })).toBeUndefined();
  expect((await ui.find({ key: 'trigger' }))?.props.label).toBe(
    'Optimize prompt',
  );

  await ui.unmount();
});

test('a run past its limit fails and its late reply is dropped', async ($, on) => {
  const { reply, release } = heldReply();
  const { world, clock } = standInForEngine(on, () => reply);
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' });

  await typeDraft($, world, 'fix bug');

  const pressed = ui.press({ key: 'trigger' });

  await clock.advance(120_000);

  expect((await ui.find({ type: 'Text' }))?.text).toBe(
    'failed: the model took too long',
  );

  release(answered('Fix the failing login test.'));
  await pressed;

  expect(world.draft).toBe('fix bug');
  await ui.unmount();
});

test('the desktop draws its own tree, with a button on an empty box', async ($, on) => {
  const { world } = standInForEngine(on, () => answered('unused'));
  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' });

  expect((await desktop.find({ key: 'trigger' }))?.props).toEqual({
    key: 'trigger',
    label: 'Optimize prompt',
  });

  await desktop.press({ key: 'trigger' });

  expect(world.toasts).toEqual([
    'Nothing to optimize. The prompt box is empty.',
  ]);

  await typeDraft($, world, 'fix bug');

  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' });

  expect((await terminal.find({ key: 'trigger' }))?.props).toEqual({
    key: 'trigger',
    label: 'Optimize prompt',
    action: 'app:cycleDiffBase',
    dimColor: true,
  });

  await desktop.unmount();
  await terminal.unmount();
});

test('the trigger stands at the left end of the row and the progress band takes the columns it leaves', async ($, on) => {
  const { world, clock } = standInForEngine(on, () => answered('unused'));

  answerSessionStart(on);
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true });
  await clock.settle();
  await typeDraft($, world, 'fix bug');

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' });
  const row = (await ui.drawn()) as Drawn;
  const [trigger, rest] = row.children ?? [];

  expect({
    row: row.props,
    trigger: [trigger?.type, trigger?.children],
    rest: rest?.props,
    progress: (await ui.find({ type: 'Text' }))?.text,
  }).toEqual({
    row: { flexDirection: 'row', alignItems: 'center', gap: 1 },
    trigger: ['Button', ['✦']],
    rest: { flexDirection: 'column', flexGrow: 1, minWidth: 0 },
    progress: 'Claude 5h 77%'.padStart(BAND.props.bodyColumns - 6),
  });

  await ui.unmount();
});

/** Holds what the prompt optimizer reaches through `$`, in place of the engine. */
type World = {
  draft: string;
  toasts: string[];
  forkPrompts: string[];
  replyToFork: (prompt: string) => ModelForkResult | Promise<ModelForkResult>;
};

/** An element of a drawn tree as plain data, the kit's `drawn()` answer. */
type Drawn = {
  type: string;
  props?: Record<string, unknown>;
  children?: Drawn[];
};

/** Answers the prompt box, the toasts, the clock and the fork of the session as the engine beneath the plugin, and returns what they hold. */
function standInForEngine(on: On, replyToFork: World['replyToFork']) {
  const world: World = { draft: '', toasts: [], forkPrompts: [], replyToFork };
  const clock = mock.clock(on);

  on('prompt.read', () => ({
    value: { text: world.draft, cursor: world.draft.length },
  }));

  on('prompt.edit', (_, e) => {
    world.draft = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end);

    return { text: world.draft, cursor: e.start + e.inputText.length };
  });

  on('prompt.fill', (_, e) => {
    world.draft = e.text;

    return { isFilled: true, text: e.text, cursor: e.text.length };
  });

  on('ui.toast', (_, e) => {
    world.toasts.push(e.text);

    return { value: undefined };
  });

  on('model.fork', async (_, e) => {
    world.forkPrompts.push(e.prompt);

    return { value: await world.replyToFork(e.prompt) };
  });

  return { world, clock };
}

/** Answers the session start with a reading of 77.5% left of the current session and a failed read of every provider, so the progress band draws the Claude usage alone. */
function answerSessionStart(on: On): void {
  on('session.start', (_, e) => ({ cwd: e.cwd }));

  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200_000 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 22.5 }],
    },
  }));

  on('process.run', () => ({
    value: {
      exitCode: 1,
      stdout: '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }));
}

function answered(text: string) {
  return { isAnswered: true as const, text, usage: USAGE };
}

/** Returns a fork reply that stays pending until the test calls `release`. */
function heldReply() {
  let release: (reply: ModelForkResult) => void = () => {};

  const reply = new Promise<ModelForkResult>(resolve => {
    release = resolve;
  });

  return { reply, release };
}

/** Replaces the whole draft the way the person's own edit does. */
function typeDraft($: Engine, world: World, text: string) {
  // Casts because the kit raises `prompt.edit` while its typings leave it off the test's `$`.
  const prompt = $.prompt as unknown as {
    edit: (edit: PromptEditInput) => Promise<PromptEditResult>;
  };

  return prompt.edit({
    origin: { kind: 'composer' },
    text: world.draft,
    cursor: world.draft.length,
    start: 0,
    end: world.draft.length,
    inputText: text,
  });
}

/** Reads the draft a request carries between its id-matched tags. */
function draftIn(prompt: string): string | undefined {
  return FRAMED_DRAFT.exec(prompt)?.[2];
}

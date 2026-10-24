// Turns the main session's todo calls, Codex calls and prompts into events of the run, reads the Codex usage when the session starts, on each prompt and after each Codex call, and draws the run above the prompt.
// https://code.claude.com/docs/en/plugins/mods/events.md

import type {
  BuiltinToolInputs,
  ElementTable,
  EngineInterface,
  PromptOrigin,
  Register,
  RenderElement,
  TextProps,
  ToolCallResult,
} from 'claude-code';

import { bandLine, bandOf, INITIAL_RUN, parseUsage, step } from './run.mts';
import type {
  Band,
  Budget,
  CodexUsage,
  Event,
  Progress,
  Run,
  Tone,
} from './run.mts';

/** The run of the session, written only by `dispatch`. */
let run: Run = INITIAL_RUN;

/** Outlasts the usage script's own 30 s timeout, so the script reports its failure before the call is cut. */
const READ_TIMEOUT_MS = 40_000;

/** Names the origins of a prompt the person sent, so a task notification never dismisses a finished list. */
const PERSON_ORIGINS: ReadonlySet<PromptOrigin['kind']> = new Set([
  'composer',
  'bridge',
  'sdk',
  'slack-ping',
]);

const TONES: Record<Tone, TextProps> = {
  plain: {},
  quiet: { dimColor: true },
  alarm: { color: 'error' },
};

/** Colors the windows of the Codex caption, which stay in the text color unless below the minimum. */
const WINDOW_TONES: Record<CodexUsage['tone'], TextProps> = {
  quiet: {},
  alarm: { color: 'error' },
};

/** Cells the bar of the done share takes beside the count. */
const BAR_CELLS = 8;

export const register: Register = on => {
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e);

    if (e.agentId === undefined && succeeded(ran)) {
      const todos = e.todos.map(({ content, status }) => ({
        id: null,
        title: content,
        status,
      }));

      dispatch($, { kind: 'todosWritten', todos });
    }

    return ran;
  }).catch(($, e, next) => next(e));

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e);

    if (e.agentId === undefined && succeeded(ran)) {
      const { id, subject } = ran.result.task;
      const task = { id, title: subject, status: 'pending' as const };

      dispatch($, { kind: 'taskCreated', task });
    }

    return ran;
  }).catch(($, e, next) => next(e));

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e);

    if (e.agentId === undefined && succeeded(ran) && ran.result.success) {
      dispatch($, taskEvent(e, ran.result.updatedFields));
    }

    return ran;
  }).catch(($, e, next) => next(e));

  on(
    'tool.call',
    { tool: 'Agent', subagent_type: 'codex:codex-rescue' },
    async ($, e, next) => {
      const ran = await next(e);

      if (succeeded(ran)) {
        void readUsage($);
      }

      return ran;
    },
  ).catch(($, e, next) => next(e));

  on('prompt.submit', ($, e, next) => {
    if (e.isMeta === true) {
      return next(e);
    }

    if (PERSON_ORIGINS.has(e.origin.kind)) {
      dispatch($, { kind: 'personPrompted' });
    }

    void readUsage($);

    return next(e);
  }).catch(($, e, next) => next(e));

  on('session.start', ($, e, next) => {
    void readUsage($);

    return next(e);
  });

  on('session.end', ($, e, next) => {
    if (e.reason === 'clear') {
      dispatch($, { kind: 'cleared' });
    }

    return next(e);
  });

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    const band = bandOf(run);

    if (band === null || e.props.hasSurvey) {
      return next(e);
    }

    // Every other surface has the Box and Text the graphical tree draws with, mobile included.
    return e.surface === 'terminal'
      ? terminalBand($.ui.resolve(e), band, e.props.bodyColumns)
      : graphicalBand($.ui.resolve(e), band);
  });
};

/** Draws the band as one line of characters cut to the columns, the Codex usage padded to the right edge. */
function terminalBand(
  { Text }: Pick<ElementTable, 'Text'>,
  band: Band,
  columns: number,
): RenderElement {
  const children = bandLine(band, columns).map(({ text, tone }) =>
    Text({ ...TONES[tone], children: [text] }),
  );

  return Text({ wrap: 'truncate-end', children });
}

/** Draws the band as a row of the progress and the Codex usage as a caption at the right end. */
function graphicalBand(
  { Box, Text }: Pick<ElementTable, 'Box' | 'Text'>,
  band: Band,
): RenderElement {
  if (band.progress === null) {
    return Box({
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      children: [codexCaption({ Box, Text }, band.codex)],
    });
  }

  const codex =
    band.codex === null ? [] : [codexCaption({ Box, Text }, band.codex)];

  return Box({
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'sm',
    children: [...progressParts({ Box, Text }, band.progress), ...codex],
  });
}

/** Draws the count with a bar of the done share and the title the surface truncates by its own width. */
function progressParts(
  { Box, Text }: Pick<ElementTable, 'Box' | 'Text'>,
  { count, filled, title }: Progress,
): RenderElement[] {
  const progress = Box({
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'xs',
    flexShrink: 0,
    children: [
      Text({ tabular: true, weight: 'medium', children: [count] }),
      Box({
        width: BAR_CELLS,
        height: 1,
        backgroundColor: 'subtle',
        children: [
          Box({
            width: filled,
            height: 1,
            backgroundColor: title === null ? 'success' : 'claude',
          }),
        ],
      }),
    ],
  });

  // A flex item does not shrink below its content without a minimum width, so the title would push the Codex usage out instead of truncating.
  // https://developer.mozilla.org/en-US/docs/Web/CSS/min-width#auto
  const titleBox = Box({
    flexGrow: 1,
    minWidth: 0,
    children: [
      title === null
        ? Text({ dimColor: true, children: ['done'] })
        : Text({ wrap: 'truncate-end', children: [title] }),
    ],
  });

  return [progress, titleBox];
}

/** Draws `Codex` and each window as small text, the windows and `below minimum` in the error color in the alarm tone. */
function codexCaption(
  { Box, Text }: Pick<ElementTable, 'Box' | 'Text'>,
  { windows, tone }: CodexUsage,
): RenderElement {
  const separator = Text({ size: 'caption', dimColor: true, children: ['·'] });
  const parts = windows.flatMap((window, index) => [
    ...(index === 0 ? [] : [separator]),
    Text({
      size: 'caption',
      tabular: true,
      ...WINDOW_TONES[tone],
      children: [window],
    }),
  ]);

  const alarm =
    tone === 'alarm'
      ? [
          Text({
            size: 'caption',
            ...WINDOW_TONES.alarm,
            children: ['below minimum'],
          }),
        ]
      : [];

  return Box({
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'xs',
    flexShrink: 0,
    children: [
      Text({ size: 'caption', dimColor: true, children: ['Codex'] }),
      ...parts,
      ...alarm,
    ],
  });
}

/** Applies an event to the run, the one writer of the run, and draws the band again. */
function dispatch($: EngineInterface, event: Event): void {
  run = step(run, event);
  $.ui.invalidate('ui.render');
}

/** Reads the usage outside any hook's time and applies the answer as one more event. */
async function readUsage($: EngineInterface): Promise<void> {
  dispatch($, { kind: 'codexRead', budget: await runUsageScript($) });
}

/** Asks `codex-model.mts --usage` for the usage left, null when Node, the Codex CLI or the sign-in is missing or the read fails. */
async function runUsageScript($: EngineInterface): Promise<Budget | null> {
  const script = `${$.plugin.root}/skills/workflow/engineering/scripts/codex-model.mts`;

  try {
    const { exitCode, stdout } = await $.process.run(
      ['node', script, '--usage'],
      { timeoutMs: READ_TIMEOUT_MS },
    );

    return exitCode === 0 ? parseUsage(stdout) : null;
  } catch {
    return null;
  }
}

/** Tells a tool's result from a refusal and from an error the tool reported. */
function succeeded<T extends string>(
  ran: ToolCallResult<T>,
): ran is Extract<ToolCallResult<T>, { result: unknown; isError?: undefined }> {
  return ran.deny === undefined && ran.isError !== true;
}

/** Parses a TaskUpdate call that the tool accepted into the event of the run, taking only the fields its result says it applied. */
function taskEvent(
  input: BuiltinToolInputs['TaskUpdate'],
  updated: readonly string[],
): Event {
  const status = updated.includes('status') ? input.status : undefined;

  if (status === 'deleted') {
    return { kind: 'taskDeleted', id: input.taskId };
  }

  return {
    kind: 'taskEdited',
    id: input.taskId,
    title: updated.includes('subject') ? input.subject : undefined,
    status,
  };
}

// Turns the main session's todo calls, provider calls, prompts and usage measurements into events of the run, reads the usage of each provider when the session starts, on each prompt and after each call of its subagent, reads the Claude usage when the session starts, and draws the run above the prompt.
// https://code.claude.com/docs/en/plugins/mods/events.md

import type {
  BuiltinToolInputs,
  ElementTable,
  EngineInterface,
  PromptOrigin,
  Register,
  RenderElement,
  SessionRateLimit,
  TextProps,
  ToolCallResult,
} from 'claude-code';

import {
  bandLine,
  bandOf,
  INITIAL_RUN,
  parseUsage,
  PROVIDERS,
  step,
} from './run.mts';
import type {
  Band,
  Budget,
  Event,
  Progress,
  Provider,
  ProviderUsage,
  Run,
  Tone,
} from './run.mts';

/** The run of the session, written only by `dispatch`. */
let run: Run = INITIAL_RUN;

/** Outlasts the usage script's own 30 s timeout, so the script reports its failure before the call is cut. */
const READ_TIMEOUT_MS = 40_000;

/** The script of the engineering skill that reports the usage of a provider with `--usage`. */
const SCRIPTS: Record<Provider, string> = {
  codex: 'codex-model.mts',
  antigravity: 'antigravity-model.mts',
};

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

/** Colors the readings of a usage caption, which stay in the text color unless below the minimum of the provider. */
const READING_TONES: Record<ProviderUsage['tone'], TextProps> = {
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
    async ($, e, next) => readAfter($, 'codex', await next(e)),
  ).catch(($, e, next) => next(e));

  on(
    'tool.call',
    { tool: 'Agent', subagent_type: 'antigravity:antigravity-rescue' },
    async ($, e, next) => readAfter($, 'antigravity', await next(e)),
  ).catch(($, e, next) => next(e));

  on('prompt.submit', ($, e, next) => {
    if (e.isMeta === true) {
      return next(e);
    }

    if (PERSON_ORIGINS.has(e.origin.kind)) {
      dispatch($, { kind: 'personPrompted' });
    }

    readUsages($);

    return next(e);
  }).catch(($, e, next) => next(e));

  on('session.start', ($, e, next) => {
    readUsages($);
    void readSessionUsage($);

    return next(e);
  });

  on('session.measure', ($, e, next) => {
    dispatch($, { kind: 'claudeMeasured', left: sessionLeft(e.rateLimits) });

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

/** Draws the band as one line of characters cut to the columns, the Claude usage at the left edge and the usages of the providers padded to the right edge. */
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

/** Draws the band as a row of the Claude usage as a caption at the left end, the progress and a caption for the usage of each provider at the right end. */
function graphicalBand(
  { Box, Text }: Pick<ElementTable, 'Box' | 'Text'>,
  band: Band,
): RenderElement {
  const claude =
    band.claude === null
      ? []
      : [
          usageCaption(
            { Box, Text },
            {
              label: 'Claude',
              readings: [band.claude.window],
              tone: 'quiet',
            },
          ),
        ];

  const usages = band.usages.map(usage => usageCaption({ Box, Text }, usage));

  if (band.progress === null) {
    // The Claude caption takes the free width, which pushes the captions of the providers to the right end.
    return Box({
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 'sm',
      children: [
        ...claude.map(caption =>
          Box({ flexGrow: 1, minWidth: 0, children: [caption] }),
        ),
        ...usages,
      ],
    });
  }

  return Box({
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'sm',
    children: [
      ...claude,
      ...progressParts({ Box, Text }, band.progress),
      ...usages,
    ],
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

  // A flex item does not shrink below its content without a minimum width, so the title would push the usages out instead of truncating.
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

/** Draws the label such as `Codex` and each reading as small text, the readings and `below minimum` in the error color in the alarm tone. */
function usageCaption(
  { Box, Text }: Pick<ElementTable, 'Box' | 'Text'>,
  { label, readings, tone }: ProviderUsage,
): RenderElement {
  const separator = Text({ size: 'caption', dimColor: true, children: ['·'] });
  const parts = readings.flatMap((reading, index) => [
    ...(index === 0 ? [] : [separator]),
    Text({
      size: 'caption',
      tabular: true,
      ...READING_TONES[tone],
      children: [reading],
    }),
  ]);

  const alarm =
    tone === 'alarm'
      ? [
          Text({
            size: 'caption',
            ...READING_TONES.alarm,
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
      Text({ size: 'caption', dimColor: true, children: [label] }),
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

/** Starts the read of every provider at once, so a slow provider never delays the answer of another. */
function readUsages($: EngineInterface): void {
  for (const provider of PROVIDERS) {
    void readUsage($, provider);
  }
}

/** Reads the usage of the provider again once a call of its subagent succeeded, and hands back the result of the call. */
function readAfter<T extends string>(
  $: EngineInterface,
  provider: Provider,
  ran: ToolCallResult<T>,
): ToolCallResult<T> {
  if (succeeded(ran)) {
    void readUsage($, provider);
  }

  return ran;
}

/** Reads the usage of the provider outside any hook's time and applies the answer as one more event. */
async function readUsage(
  $: EngineInterface,
  provider: Provider,
): Promise<void> {
  dispatch($, {
    kind: 'usageRead',
    provider,
    budget: await runUsageScript($, provider),
  });
}

/** Reads the Claude usage outside the session start hook's time and applies it as one more event, with no reading when the read is refused. */
async function readSessionUsage($: EngineInterface): Promise<void> {
  const rateLimits = await $.session.usage().then(
    usage => usage.rateLimits,
    () => [],
  );

  dispatch($, { kind: 'claudeMeasured', left: sessionLeft(rateLimits) });
}

/** Parses the rate-limit windows into the whole percent left of the current session's 5-hour window, rounded down and held to 0 to 100, null with no reading of it. */
function sessionLeft(rateLimits: readonly SessionRateLimit[]): number | null {
  const session = rateLimits.find(limit => limit.kind === 'five_hour');

  if (session === undefined) {
    return null;
  }

  return Math.min(100, Math.max(0, Math.floor(100 - session.percentUsed)));
}

/** Asks the script of the provider for its usage left with `--usage`, null when Node, the CLI of the provider or the sign-in is missing or the read fails. */
async function runUsageScript(
  $: EngineInterface,
  provider: Provider,
): Promise<Budget | null> {
  const script = `${$.plugin.root}/skills/workflow/engineering/scripts/${SCRIPTS[provider]}`;

  try {
    const { exitCode, stdout } = await $.process.run(
      ['node', script, '--usage'],
      { timeoutMs: READ_TIMEOUT_MS },
    );

    return exitCode === 0 ? parseUsage(provider, stdout) : null;
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

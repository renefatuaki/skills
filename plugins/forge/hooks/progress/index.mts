// Turns the main session's todo calls, provider calls, prompts and usage measurements into events of the run, reads the usage of each provider when the session starts, on each prompt and after each call of its subagent, reads the Claude usage when the session starts and when a measurement moves its windows, takes the context fill from the session start and from each measurement that moves it, and draws the run above the prompt.
// https://code.claude.com/docs/en/plugins/mods/events.md

import type {
  BuiltinToolInputs,
  ElementTable,
  EngineInterface,
  Frozen,
  PromptOrigin,
  PromptSubmitInput,
  Register,
  RenderElement,
  RenderInput,
  SessionRateLimit,
  TextProps,
  ToolCallResult,
} from 'claude-code';

import {
  bandLine,
  bandOf,
  INITIAL_RUN,
  leftOf,
  parseModelLimits,
  parseUsage,
  PROVIDERS,
  step,
} from './run.mts';
import type {
  Band,
  Budget,
  Event,
  Limit,
  Progress,
  Provider,
  Run,
  Tone,
  Usage,
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

/** The endpoint that reports the weekly limit per model, which the engine's rate-limit reading leaves out. */
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

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
const READING_TONES: Record<Usage['tone'], TextProps> = {
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

  on('session.start', ($, e, next) => {
    readUsages($);
    void readSessionUsage($);

    return next(e);
  });

  on('session.measure', ($, e, next) => {
    if (e.changed.includes('context')) {
      dispatch($, contextMeasured(e.context.percent));
    }

    if (e.changed.includes('rateLimits')) {
      void readClaude($, e.rateLimits);
    }

    return next(e);
  });

  on('session.end', ($, e, next) => {
    if (e.reason === 'clear') {
      dispatch($, { kind: 'cleared' });
    }

    return next(e);
  });
};

/** Notes a prompt of the person as an event of the run and reads the usage of each provider again, unless the prompt is a meta one. */
export function notePrompt(
  $: EngineInterface,
  e: Frozen<PromptSubmitInput>,
): void {
  if (e.isMeta === true) {
    return;
  }

  if (PERSON_ORIGINS.has(e.origin.kind)) {
    dispatch($, { kind: 'personPrompted' });
  }

  readUsages($);
}

/** Draws the run above the prompt at the given terminal columns, null while the run has nothing to show or a survey holds the band. */
export function progressBand(
  $: EngineInterface,
  e: Frozen<RenderInput<'AbovePrompt'>>,
  columns: number,
): RenderElement | null {
  const band = bandOf(run);

  if (band === null || e.props.hasSurvey) {
    return null;
  }

  // Every other surface has the Box and Text the graphical tree draws with, mobile included.
  return e.surface === 'terminal'
    ? terminalBand($.ui.resolve(e), band, columns)
    : graphicalBand($.ui.resolve(e), band);
}

/** Draws the band as one line of characters cut to the columns, the progress at the left edge and the usages padded to the right edge. */
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

/** Draws the band as a row of the progress and a caption for each usage at the right end, the Claude caption first. */
function graphicalBand(
  { Box, Text }: Pick<ElementTable, 'Box' | 'Text'>,
  band: Band,
): RenderElement {
  const usages = band.usages.map(usage => usageCaption({ Box, Text }, usage));

  if (band.progress === null) {
    return Box({
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 'sm',
      children: usages,
    });
  }

  return Box({
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'sm',
    children: [...progressParts({ Box, Text }, band.progress), ...usages],
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

/** Draws the label such as `Claude` and each reading as small text, the readings and `below minimum` in the error color in the alarm tone. */
function usageCaption(
  { Box, Text }: Pick<ElementTable, 'Box' | 'Text'>,
  { label, readings, tone }: Usage,
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

/** Reads the context fill and the Claude usage outside the session start hook's time and applies them as more events, with no reading when the read is refused. */
async function readSessionUsage($: EngineInterface): Promise<void> {
  const usage = await $.session.usage().catch(() => null);

  dispatch($, contextMeasured(usage?.context.percent));
  await readClaude($, usage?.rateLimits ?? []);
}

/** Wraps the percent of the context window used into its event, no percent before the first response of the window. */
function contextMeasured(percent: number | undefined): Event {
  return { kind: 'contextMeasured', percent: percent ?? null };
}

/** Applies the account windows of a reading at once, then the weekly limit per model, which only an account with no 5-hour window has. */
async function readClaude(
  $: EngineInterface,
  rateLimits: readonly SessionRateLimit[],
): Promise<void> {
  const windows = claudeWindows(rateLimits);

  dispatch($, { kind: 'claudeMeasured', windows });

  const models = windows[0]?.name === 'week' ? await readModelLimits($) : [];

  dispatch($, { kind: 'claudeModelsRead', models });
}

/** Parses the rate-limit windows into the 5-hour window as `5h` or else the weekly window as `week`, each with the whole percent left, none with no reading of either. */
function claudeWindows(rateLimits: readonly SessionRateLimit[]): Limit[] {
  const session = rateLimits.find(limit => limit.kind === 'five_hour');
  const week = rateLimits.find(limit => limit.kind === 'seven_day');

  if (session !== undefined) {
    return [{ name: '5h', left: leftOf(session.percentUsed) }];
  }

  return week === undefined
    ? []
    : [{ name: 'week', left: leftOf(week.percentUsed) }];
}

/** Reads the weekly limit per model from the usage endpoint with the session's own login, none when there is no first-party login or the read fails. */
async function readModelLimits($: EngineInterface): Promise<Limit[]> {
  try {
    const auth = await $.session.authorize();

    if (auth === null) {
      return [];
    }

    const response = await $.http.fetch(USAGE_URL, {
      auth: auth.handle,
      headers: { 'anthropic-beta': 'oauth-2025-04-20' },
    });

    return response.ok ? parseModelLimits(response.text) : [];
  } catch {
    return [];
  }
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

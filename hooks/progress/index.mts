// Turns the main session's todo calls, Codex calls and prompts into events of the run, and draws the run above the prompt.
// https://code.claude.com/docs/en/plugins/mods/events.md

import type {
  BuiltinToolInputs,
  EngineInterface,
  PromptOrigin,
  Register,
  TextProps,
  ToolCallResult,
} from 'claude-code';

import { bandLine, INITIAL_RUN, parseUsage, step } from './run.mts';
import type { Budget, Event, Run, Tone } from './run.mts';

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
    if (e.isMeta !== true && PERSON_ORIGINS.has(e.origin.kind)) {
      dispatch($, { kind: 'personPrompted' });
    }

    return next(e);
  }).catch(($, e, next) => next(e));

  on('session.end', ($, e, next) => {
    if (e.reason === 'clear') {
      dispatch($, { kind: 'cleared' });
    }

    return next(e);
  });

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    const line = bandLine(run, e.props.bodyColumns);

    if (line === null || e.props.hasSurvey) {
      return next(e);
    }

    const { Text } = $.ui.resolve(e);
    const children = line.map(({ text, tone }) =>
      Text({ ...TONES[tone], children: [text] }),
    );

    return Text({ wrap: 'truncate-end', children });
  });
};

/** Applies an event to the run, the one writer of the run, draws the band again and reads the usage when the step started a run. */
function dispatch($: EngineInterface, event: Event): void {
  const next = step(run, event);

  run = next.run;
  $.ui.invalidate('ui.render');

  if (next.startRead) {
    void readUsage($);
  }
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

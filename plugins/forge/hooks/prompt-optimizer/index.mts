// Rewrites the unsent draft in the prompt box into a clearer prompt on a key chord, never sends it, and cancels the run or restores the draft on the next press.
// https://code.claude.com/docs/en/plugins/mods/events.md

import { atom, read, update } from 'claude-code';
import type {
  EngineInterface,
  Frozen,
  PromptSubmitInput,
  Register,
  RenderElement,
  RenderInput,
} from 'claude-code';

import type { Phase } from '../../types/index.d.ts';
import { appBand, terminalBand } from './band.mts';
import { rewriteDraft } from './rewrite.mts';

const IDLE: Phase = { kind: 'idle' };
const FAILURE_VISIBLE_MS = 6000;
const RUN_LIMIT_MS = 120_000;
const BOX_REFUSED = 'the prompt box did not take the text';

const phase = atom({ plugin: 'forge', key: 'phase' } as const, IDLE);
const hasDraft = atom({ plugin: 'forge', key: 'hasDraft' } as const, false);

// Lives in the module because a signal cannot be kept in `$.state`.
let runInFlight: AbortController | undefined;

export const register: Register = on => {
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e);

    await noteDraft($, box.text);

    return box;
  });

  on('prompt.change', async ($, e, next) => {
    await noteDraft($, e.text);

    return next(e);
  });
};

/** Ends undo once the person sends a prompt, because the rewrite has left the prompt box by then. */
export async function forgetRewrite(
  $: EngineInterface,
  e: Frozen<PromptSubmitInput>,
): Promise<void> {
  if (e.isMeta) {
    return;
  }

  const current = await read($, phase);

  if (current.kind === 'optimized') {
    await enter($, IDLE);
  }
}

/** Draws the trigger above the prompt, null while a survey holds the band and on the terminal while the box is empty and no run shows. */
export async function promptOptimizerBand(
  $: EngineInterface,
  e: Frozen<RenderInput<'AbovePrompt'>>,
  chord: string,
): Promise<RenderElement | null> {
  const current = await read($, phase);
  const isDraftPresent = await read($, hasDraft);

  if (e.props.hasSurvey) {
    return null;
  }

  const band = { phase: current, chord, onTrigger: () => trigger($) };

  if (e.surface === 'desktop' || e.surface === 'mobile') {
    return appBand($.ui.resolve(e), band);
  }

  if (
    e.surface !== 'terminal' ||
    (current.kind === 'idle' && !isDraftPresent)
  ) {
    return null;
  }

  return terminalBand($.ui.resolve(e), band);
}

async function trigger($: EngineInterface): Promise<void> {
  const current = await read($, phase);

  if (current.kind === 'optimizing') {
    return cancel($);
  }

  const draft = (await $.prompt.read()).text;

  if (current.kind === 'optimized' && draft === current.rewritten) {
    return undo($, current.original);
  }

  if (draft.trim() === '') {
    $.ui.toast('Nothing to optimize. The prompt box is empty.');
    await enter($, IDLE);

    return;
  }

  return optimize($, draft);
}

async function cancel($: EngineInterface): Promise<void> {
  runInFlight?.abort();
  await enter($, IDLE);
}

async function undo($: EngineInterface, original: string): Promise<void> {
  const restored = await $.prompt.fill({ text: original, mode: 'replace' });

  if (!restored.isFilled) {
    return fail($, BOX_REFUSED);
  }

  await enter($, IDLE);
}

async function optimize($: EngineInterface, draft: string): Promise<void> {
  const run = await startRun($, draft);
  const rewrite = await rewriteDraft($, draft, run.signal);

  if (run.signal.aborted) {
    return;
  }

  if (!rewrite.isRewritten) {
    return fail($, rewrite.reason);
  }

  await land($, { original: draft, rewritten: rewrite.text });
}

async function startRun(
  $: EngineInterface,
  draft: string,
): Promise<AbortController> {
  const run = new AbortController();

  runInFlight = run;

  const startedAt = await $.clock.now();

  await enter($, { kind: 'optimizing', original: draft, startedAt });
  $.clock.after(RUN_LIMIT_MS, () => void expire($, startedAt));

  return run;
}

/** Ends a run that outlasted its limit, unless the phase has moved on from it. */
async function expire($: EngineInterface, startedAt: number): Promise<void> {
  const current = await read($, phase);

  if (current.kind !== 'optimizing' || current.startedAt !== startedAt) {
    return;
  }

  runInFlight?.abort();
  await fail($, 'the model took too long');
}

async function land(
  $: EngineInterface,
  { original, rewritten }: { original: string; rewritten: string },
): Promise<void> {
  const draft = (await $.prompt.read()).text;

  if (draft !== original) {
    $.ui.toast('The draft changed while optimizing. The rewrite was dropped.');

    return enter($, IDLE);
  }

  if (rewritten === original) {
    $.ui.toast('The draft is already clear. Nothing changed.');

    return enter($, IDLE);
  }

  const filled = await $.prompt.fill({ text: rewritten, mode: 'replace' });

  if (!filled.isFilled) {
    return fail($, BOX_REFUSED);
  }

  // Stores the text as the box holds it, because undo compares against the box.
  await enter($, { kind: 'optimized', original, rewritten: filled.text });
}

async function fail($: EngineInterface, reason: string): Promise<void> {
  await enter($, { kind: 'failed', reason });
  $.clock.after(FAILURE_VISIBLE_MS, () => void clearFailure($, reason));
}

async function clearFailure($: EngineInterface, reason: string): Promise<void> {
  await update($, phase, current =>
    current.kind === 'failed' && current.reason === reason ? IDLE : current,
  );
}

async function noteDraft($: EngineInterface, draft: string): Promise<void> {
  const isDraftPresent = draft !== '';

  if ((await read($, hasDraft)) !== isDraftPresent) {
    await update($, hasDraft, () => isDraftPresent);
  }

  const current = await read($, phase);

  if (current.kind === 'optimized' && draft !== current.rewritten) {
    await enter($, IDLE);
  }
}

async function enter($: EngineInterface, next: Phase): Promise<void> {
  await update($, phase, () => next);
}

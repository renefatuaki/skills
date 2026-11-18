// Asks a Claude model for the rewrite of a draft and strips what the model wrapped around its reply.
// https://code.claude.com/docs/en/plugins/mods/reference.md

import type { EngineInterface, ModelCompleteResult } from 'claude-code';

import { OPTIMIZER_SYSTEM } from './optimizer-prompt.mts';

export type Rewrite =
  | { isRewritten: true; text: string }
  | { isRewritten: false; reason: string };

type Unanswered = Exclude<ModelCompleteResult, { isAnswered: true }>;

const EFFORT = 'low';
const FALLBACK_MODEL = 'sonnet';
const FALLBACK_REPLY_TOKENS = 4096;
// Matches a reply that is one wrapper around a body, and captures the body.
const REPLY_WRAPPERS = [
  /^<rewritten>((?:(?!<\/?rewritten>)[\s\S])*)<\/rewritten>$/,
  /^```[^\n]*\n((?:(?!```)[\s\S])*)\n```$/,
  /^"([^"]*)"$/,
  /^'([^']*)'$/,
  /^“([^“”]*)”$/,
];

export async function rewriteDraft(
  $: EngineInterface,
  draft: string,
  signal: AbortSignal,
): Promise<Rewrite> {
  const reply = await askModel($, draft, signal);

  if (!reply.isAnswered) {
    return { isRewritten: false, reason: describeUnanswered(reply) };
  }

  const text = unwrapReply(reply.text);

  if (text === '') {
    return { isRewritten: false, reason: 'the model returned no text' };
  }

  return { isRewritten: true, text };
}

/** Asks over the session's transcript first, so the model knows what the draft refers to. */
async function askModel(
  $: EngineInterface,
  draft: string,
  signal: AbortSignal,
): Promise<ModelCompleteResult> {
  const framedDraft = frameDraft(draft);
  const forked = await $.model.fork({
    prompt: `${OPTIMIZER_SYSTEM}\n\n${framedDraft}`,
    effort: EFFORT,
  });

  if (forked.isAnswered || forked.reason !== 'nothing-to-fork') {
    return forked;
  }

  return $.model.complete(
    {
      model: FALLBACK_MODEL,
      system: OPTIMIZER_SYSTEM,
      prompt: framedDraft,
      effort: EFFORT,
      maxTokens: FALLBACK_REPLY_TOKENS,
    },
    { signal },
  );
}

/** Tags the draft with a fresh id on both ends, so a closing tag inside the draft cannot end it early. */
function frameDraft(draft: string): string {
  const id = crypto.randomUUID();

  return `<draft id="${id}">\n${draft}\n</draft id="${id}">`;
}

function describeUnanswered(reply: Unanswered): string {
  switch (reply.reason) {
    case 'api-error':
      return `the API answered with ${reply.error}`;
    case 'empty-reply':
      return 'the model returned no text';
    case 'aborted':
      return 'the request was interrupted';
  }
}

/** Strips one tag, code fence or pair of quotes the model wrapped around the whole reply. */
function unwrapReply(reply: string): string {
  const trimmed = reply.trim();

  for (const wrapper of REPLY_WRAPPERS) {
    const body = wrapper.exec(trimmed)?.[1];

    if (body !== undefined) {
      return body.trim();
    }
  }

  return trimmed;
}

#!/usr/bin/env node

// Denies an AskUserQuestion call until the message that makes it holds the facts the question needs as text.
// https://code.claude.com/docs/en/hooks.md#pretooluse

import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  deny,
  type HookInput,
  readHookInput,
  transcriptOf,
} from './lib/hook.mts';

/** One record of the transcript, the fields the hook reads. A record holds one content block of a message. */
type TranscriptRecord = {
  type?: unknown;
  message?: {
    content?: unknown;
  };
};

/** How long the hook waits for the call to reach the transcript, and how often it looks. */
const WAIT_MS = 3000;
const POLL_MS = 50;

const REASON =
  'Write the facts and research this decision needs as text in the message first, then ask again. The user reads that text before the question and cannot see your thinking.';

await main();

async function main(): Promise<void> {
  // 1. Stay silent for an input that names no call or no transcript.
  const input = readHookInput() as HookInput;
  const transcriptPath = transcriptOf(input);

  if (typeof input.tool_use_id !== 'string' || transcriptPath === null) {
    return;
  }

  // 2. Read the transcript up to the call, and stay silent when it cannot be read or never shows the call.
  const records = await readUntilCall(transcriptPath, input.tool_use_id);

  if (records === null) {
    return;
  }

  // 3. Deny the call when no text came since the last tool result or user message.
  if (!holdsTextSinceInput(records)) {
    deny(REASON);
  }
}

/**
 * Reads the records up to the one that holds the call, or null when the file cannot be read or the call never appears.
 * Claude Code writes the assistant records of a message after PreToolUse has started, so the hook polls until the call shows.
 */
async function readUntilCall(
  path: string,
  toolUseId: string,
): Promise<TranscriptRecord[] | null> {
  const deadline = Date.now() + WAIT_MS;

  while (true) {
    try {
      const text = readFileSync(path, 'utf8');
      const records = text.includes(toolUseId) ? parseRecords(text) : [];
      const call = records.findLastIndex(record =>
        blocksOf(record).some(block => block.id === toolUseId),
      );

      if (call !== -1) {
        return records.slice(0, call + 1);
      }
    } catch {
      return null;
    }

    if (Date.now() >= deadline) {
      return null;
    }

    await sleep(POLL_MS);
  }
}

/** Parses every line that is a JSON object and skips the rest, such as a line that is still being written. */
function parseRecords(text: string): TranscriptRecord[] {
  return text.split('\n').flatMap(line => {
    try {
      const record: unknown = JSON.parse(line);

      return typeof record === 'object' && record !== null
        ? [record as TranscriptRecord]
        : [];
    } catch {
      return [];
    }
  });
}

/** Tells whether an assistant record with a non-empty text block stands after the last user record, a tool result or a prompt. */
function holdsTextSinceInput(records: TranscriptRecord[]): boolean {
  for (const record of records.toReversed()) {
    if (record.type === 'user') {
      return false;
    }

    if (
      record.type === 'assistant' &&
      blocksOf(record).some(
        block =>
          block.type === 'text' &&
          typeof block.text === 'string' &&
          block.text.trim() !== '',
      )
    ) {
      return true;
    }
  }

  return false;
}

/** The content blocks of the message of a record, none for a record without a block list. */
function blocksOf(record: TranscriptRecord): {
  type?: unknown;
  id?: unknown;
  text?: unknown;
}[] {
  const content = record.message?.content;

  return Array.isArray(content) ? content : [];
}

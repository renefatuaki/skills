// Ported from scripts/lib/fs.mjs of the OpenAI Codex plugin for Claude Code 1.0.6 (Apache-2.0 License, Copyright 2026 OpenAI).

import { readFileSync } from 'node:fs';

/** Tells whether the first 4096 bytes hold no NUL byte. */
export function isProbablyText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));

  return !sample.includes(0);
}

/** Reads all of stdin unless it is a terminal. */
export function readStdinIfPiped(): string {
  if (process.stdin.isTTY) {
    return '';
  }

  return readFileSync(0, 'utf8');
}

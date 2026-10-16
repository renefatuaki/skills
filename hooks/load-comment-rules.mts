#!/usr/bin/env node

// Denies the first code edit of an agent until the code-comments rules are in its context.
// https://code.claude.com/docs/en/hooks.md#pretooluse

import { readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deny, type HookInput, readHookInput } from './lib/hook.mts';
import { LANGUAGES } from './lib/languages.mts';

/** A document of the code-comments skill the agent needs and the marker that shows it in the transcript. */
type Document = {
  path: string;
  body: string;
  marker: string;
};

const SKILL = 'skills/clean-code/code-comments/SKILL.md';

/** Marks the point where compaction replaced the earlier context with a summary. */
const COMPACT_BOUNDARY = 'compact_boundary';

main();

function main(): void {
  // 1. Stay silent for a file outside the code languages and for an input that names no transcript.
  const input = readHookInput() as HookInput;
  const filePath = input.tool_input?.file_path;
  const language =
    typeof filePath === 'string'
      ? LANGUAGES[extname(filePath).toLowerCase()]
      : undefined;

  const transcriptPath = transcriptOf(input);

  if (!language || transcriptPath === null) {
    return;
  }

  // 2. Read the transcript since the last compaction, and stay silent when it cannot be read.
  const transcript = readSinceCompaction(transcriptPath);

  if (transcript === null) {
    return;
  }

  // 3. Collect the documents whose marker the transcript lacks.
  const root = process.env.CLAUDE_PLUGIN_ROOT ?? defaultRoot();
  const missing = [SKILL, language.guide]
    .map(path => readDocument(join(root, path)))
    .filter(document => document !== null)
    .filter(document => !transcript.includes(document.marker));

  if (missing.length === 0) {
    return;
  }

  // 4. Deny the edit and hand Claude the missing documents.
  deny(
    [
      'The code-comments rules apply to every code edit. They follow below. Repeat the edit with its comments following them.',
      ...missing.flatMap(document => ['', `${document.path}:`, document.body]),
    ].join('\n'),
  );
}

/** The transcript of the agent that makes the call, which for a subagent is its own file below the session folder. */
function transcriptOf(input: HookInput): string | null {
  const { transcript_path, session_id, agent_id } = input;

  if (typeof transcript_path !== 'string') {
    return null;
  }

  if (agent_id === undefined) {
    return transcript_path;
  }

  if (typeof agent_id !== 'string' || typeof session_id !== 'string') {
    return null;
  }

  const name = agent_id.startsWith('agent-') ? agent_id : `agent-${agent_id}`;

  return join(
    dirname(transcript_path),
    session_id,
    'subagents',
    `${name}.jsonl`,
  );
}

/** Reads the lines after the last compact boundary, or null when the file cannot be read. */
function readSinceCompaction(path: string): string | null {
  try {
    const lines = readFileSync(path, 'utf8').split('\n');
    const boundary = lines.findLastIndex(line =>
      line.includes(COMPACT_BOUNDARY),
    );

    return lines.slice(boundary + 1).join('\n');
  } catch {
    return null;
  }
}

/** Reads a document of the skill without its frontmatter, or null when it cannot be read. */
function readDocument(path: string): Document | null {
  try {
    const body = readFileSync(path, 'utf8')
      .replace(/^---\n[\s\S]*?\n---\n/, '')
      .trim();

    return { path, body, marker: markerOf(body) };
  } catch {
    return null;
  }
}

/** The first prose sentence of a document, cut where JSON.stringify would write it differently, so it reads the same in a transcript. */
function markerOf(body: string): string {
  const prose =
    body
      .split('\n')
      .find(line => line.trim() !== '' && !line.startsWith('#')) ?? '';

  const sentence = prose.match(/^.*?[^.]\.(?=\s|$)/)?.[0] ?? prose;
  const cut = [...sentence].findIndex(isEscaped);

  return cut === -1 ? sentence : sentence.slice(0, cut);
}

/** Tells whether JSON.stringify escapes the character or an ASCII-only reader could misread it, a quote, a backslash, a control character or a non-ASCII one. */
function isEscaped(char: string): boolean {
  const code = char.charCodeAt(0);

  return char === '"' || char === '\\' || code < 0x20 || code > 0x7e;
}

/** The plugin root as the folder above the hooks folder. */
function defaultRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

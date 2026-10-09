#!/usr/bin/env node

// Scans the file an Edit or Write touched for comment rule violations and reports them to Claude.
// https://code.claude.com/docs/en/hooks.md

import { readFileSync } from 'node:fs';
import { extname, relative } from 'node:path';

import { readEditedPath, report } from './lib/hook.mts';

/** The comment syntax of a language, slashes and blocks or hashes and docstrings. */
type Syntax = 'c' | 'python';

/** One content line of a comment, its delimiters removed, with its line number in the file. */
type CommentLine = {
  number: number;
  text: string;
};

/** A single-line comment, exempt from the length limit when it opens the file as its header. */
type LineComment = {
  kind: 'line';
  exempt: boolean;
  lines: CommentLine[];
};

/** A block comment, exempt from the length limit when it opens the file as its header. */
type BlockComment = {
  kind: 'block';
  exempt: boolean;
  lines: CommentLine[];
};

/** A docstring also carries the count of its physical lines, delimiter-only lines left out. */
type Docstring = {
  kind: 'docstring';
  exempt: boolean;
  lines: CommentLine[];
  physical: number;
};

type Comment = LineComment | BlockComment | Docstring;

/** Adjacent line comments merged into one, block comments and docstrings on their own. */
type Group = {
  kind: Comment['kind'];
  start: number;
  end: number;
  count: number;
  exempt: boolean;
};

type Finding = {
  line: number;
  rule: 'em-dash' | 'semicolon' | 'todo-link' | 'too-long';
  message: string;
};

/** Maps a file extension to its comment syntax, a file with any other extension is not checked. */
const SYNTAX: Record<string, Syntax> = {
  '.swift': 'c',
  '.kt': 'c',
  '.kts': 'c',
  '.java': 'c',
  '.ts': 'c',
  '.tsx': 'c',
  '.js': 'c',
  '.jsx': 'c',
  '.mjs': 'c',
  '.cjs': 'c',
  '.mts': 'c',
  '.cts': 'c',
  '.py': 'python',
};

/** A comment holds a summary line and a link line at most. */
const MAX_CONTENT_LINES = 2;

/**
 * A docstring with a link takes a summary line, a blank line and the link line.
 * @see {@link https://peps.python.org/pep-0257/#multi-line-docstrings | PEP 257, multi-line docstrings}
 */
const MAX_DOCSTRING_LINES = 3;

/** Matches a comment that addresses a tool, such as MARK, region, eslint or noqa, which the rules leave alone. */
const DIRECTIVE =
  /^(MARK:|#?region\b|#?endregion\b|swiftlint:|eslint-|@ts-|prettier-|noqa\b|type:|pylint:|pragma\b|biome-ignore\b)/;

/** Matches a URL, a ticket key such as ABC-123 or an issue number such as #12. */
const TICKET = /https?:\/\/|\b[A-Z][A-Z0-9]+-\d+\b|#\d+/;

main();

function main(): void {
  // 1. Read the edited path and stay silent for a language outside the list and for a file that cannot be read.
  const edited = readEditedPath();

  if (edited === null) {
    return;
  }

  const syntax = SYNTAX[extname(edited.absolute).toLowerCase()];

  if (!syntax) {
    return;
  }

  let source: string;

  try {
    source = readFileSync(edited.absolute, 'utf8');
  } catch {
    return;
  }

  // 2. Collect the findings of every rule.
  const findings = check(source, syntax);

  if (findings.length === 0) {
    return;
  }

  // 3. Hand the findings to Claude, one line each.
  const shown = relative(edited.root, edited.absolute) || edited.absolute;
  const lines = findings.map(f => `${shown}:${f.line} ${f.rule} ${f.message}`);

  report([
    'Comment rules (code-comments skill) flagged the last edit. Fix each line in your next edit:',
    ...lines,
  ]);
}

/** Applies the punctuation rules and the ticket rule to every comment line and the length limit to every comment group. */
function check(source: string, syntax: Syntax): Finding[] {
  const comments =
    syntax === 'python' ? extractPython(source) : extractCStyle(source);

  const findings: Finding[] = [];

  for (const comment of comments) {
    for (const line of comment.lines) {
      if (DIRECTIVE.test(line.text)) {
        continue;
      }

      const prose = withoutCodeAndUrls(line.text);

      if (/[—–]/.test(prose)) {
        findings.push({
          line: line.number,
          rule: 'em-dash',
          message: 'Replace the dash with a period or a comma.',
        });
      }

      if (prose.includes(';')) {
        findings.push({
          line: line.number,
          rule: 'semicolon',
          message: 'Split the comment into two sentences.',
        });
      }

      if (/\b(TODO|FIXME)\b/.test(line.text) && !TICKET.test(line.text)) {
        findings.push({
          line: line.number,
          rule: 'todo-link',
          message: 'Add a ticket or issue link on the same line.',
        });
      }
    }
  }

  for (const group of groupComments(comments)) {
    if (group.exempt) {
      continue;
    }

    const limit =
      group.kind === 'docstring' ? MAX_DOCSTRING_LINES : MAX_CONTENT_LINES;

    if (group.count > limit) {
      findings.push({
        line: group.start,
        rule: 'too-long',
        message: `Comment spans ${group.count} lines, the limit is ${limit}. Keep one summary line plus one link line.`,
      });
    }
  }

  return findings.sort((a, b) => a.line - b.line);
}

/** Removes inline code spans, URLs and HTML entities so their punctuation is not judged as prose. */
function withoutCodeAndUrls(text: string): string {
  return text
    .replace(/`[^`]*`/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/&[a-z]+;/gi, '');
}

/** Merges adjacent line comments into one group, keeps every block comment and docstring as its own group. */
function groupComments(comments: Comment[]): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;

  for (const comment of comments) {
    const countable = comment.lines.filter(l => !DIRECTIVE.test(l.text));

    if (countable.length === 0) {
      continue;
    }

    const start = countable[0].number;
    const end = countable[countable.length - 1].number;
    const count =
      comment.kind === 'docstring'
        ? comment.physical
        : countable.filter(l => l.text.trim() !== '').length;

    if (
      comment.kind === 'line' &&
      current &&
      current.kind === 'line' &&
      current.end + 1 === start
    ) {
      current.end = end;
      current.count += count;
      continue;
    }

    current = { kind: comment.kind, start, end, count, exempt: comment.exempt };
    groups.push(current);
  }

  return groups;
}

/** Walks C-style source and yields line comments and block comments with their content lines. */
function extractCStyle(source: string): Comment[] {
  const comments: Comment[] = [];
  let i = 0;
  let line = 1;
  let firstCodeSeen = false;
  const n = source.length;

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '\n') {
      line++;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(source, i, ch, () => line++);
      firstCodeSeen = true;
      continue;
    }

    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      const text = source.slice(i, stop).replace(/^\/\/+\s?/, '');

      comments.push({
        kind: 'line',
        exempt: !firstCodeSeen && line === 1,
        lines: [{ number: line, text }],
      });

      i = stop;
      continue;
    }

    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      const raw = source.slice(i, stop);
      const startLine = line;
      const lines: CommentLine[] = [];

      raw.split('\n').forEach((part, index) => {
        const text = part
          .replace(/^\s*\/\*+\s?/, '')
          .replace(/\*\/\s*$/, '')
          .replace(/^\s*\*\s?/, '');

        if (text.trim() !== '') {
          lines.push({ number: startLine + index, text });
        }
      });

      comments.push({
        kind: 'block',
        exempt: !firstCodeSeen && startLine === 1,
        lines,
      });

      line += (raw.match(/\n/g) || []).length;
      i = stop;
      continue;
    }

    if (!/\s/.test(ch)) {
      firstCodeSeen = true;
    }

    i++;
  }

  return comments;
}

/** Walks Python source and yields hash comments and docstrings with their content lines. */
function extractPython(source: string): Comment[] {
  const comments: Comment[] = [];
  const lines = source.split('\n');
  let i = 0;
  let previousCode = '';
  let onlyHeaderSoFar = true;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const number = i + 1;

    if (trimmed === '') {
      i++;
      continue;
    }

    if (trimmed.startsWith('#')) {
      const text = trimmed.replace(/^#+\s?/, '');
      const isShebang = number === 1 && trimmed.startsWith('#!');

      comments.push({
        kind: 'line',
        exempt: onlyHeaderSoFar,
        lines: isShebang ? [] : [{ number, text }],
      });

      i++;
      continue;
    }

    const quote = trimmed.match(/^(?:[rRuUbBfF]{0,2})("""|''')/);

    if (quote && (previousCode === '' || /:\s*$/.test(previousCode))) {
      const q = quote[1];
      const openEnd = raw.indexOf(q) + 3;
      let closeIndex = raw.indexOf(q, openEnd);
      let j = i;
      const contentLines: CommentLine[] = [];
      let physical = 0;

      while (closeIndex === -1 && j + 1 < lines.length) {
        j++;
        closeIndex = lines[j].indexOf(q);
      }

      for (let k = i; k <= j; k++) {
        let text = lines[k];

        if (k === i) {
          text = text.slice(openEnd);
        }

        if (k === j) {
          text = text.slice(0, closeIndex === -1 ? undefined : closeIndex);
        }

        const isDelimiterOnly = text.trim() === '' && (k === i || k === j);

        if (!isDelimiterOnly) {
          physical++;
        }

        if (text.trim() !== '') {
          contentLines.push({ number: k + 1, text: text.trim() });
        }
      }

      comments.push({
        kind: 'docstring',
        exempt: false,
        physical,
        lines: contentLines,
      });

      onlyHeaderSoFar = false;
      previousCode = '';
      i = j + 1;
      continue;
    }

    const inline = inlineHashComment(raw);

    if (inline !== null) {
      comments.push({
        kind: 'line',
        exempt: false,
        lines: [{ number, text: inline }],
      });
    }

    onlyHeaderSoFar = false;
    previousCode = stripInlineComment(raw).trim();
    i++;
  }

  return comments;
}

/** Returns the text of a trailing hash comment on a code line, or null when the hash sits inside a string. */
function inlineHashComment(rawLine: string): string | null {
  let quote: string | null = null;

  for (let i = 0; i < rawLine.length; i++) {
    const ch = rawLine[i];

    if (quote) {
      if (ch === '\\') {
        i++;
      } else if (ch === quote) {
        quote = null;
      }

      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#') {
      return rawLine.slice(i).replace(/^#+\s?/, '');
    }
  }

  return null;
}

function stripInlineComment(rawLine: string): string {
  const comment = inlineHashComment(rawLine);

  if (comment === null) {
    return rawLine;
  }

  return rawLine.slice(
    0,
    rawLine.lastIndexOf('#' + comment.replace(/^\s/, '')),
  );
}

/** Skips a string literal, counting newlines inside multi-line literals, and returns the index after it. */
function skipString(
  source: string,
  start: number,
  quote: string,
  onNewline: () => void,
): number {
  const triple = source.startsWith(quote.repeat(3), start);
  const closer = triple ? quote.repeat(3) : quote;
  let i = start + closer.length;

  while (i < source.length) {
    const ch = source[i];

    if (ch === '\\') {
      i += 2;
      continue;
    }

    if (ch === '\n') {
      if (!triple && quote !== '`') {
        return i;
      }

      onNewline();
    }

    if (source.startsWith(closer, i)) {
      return i + closer.length;
    }

    i++;
  }

  return i;
}

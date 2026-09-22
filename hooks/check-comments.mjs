#!/usr/bin/env node

// Scans the file an Edit or Write touched for comment rule violations and reports them to Claude.
// https://code.claude.com/docs/en/hooks

import { readFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";

const SYNTAX = {
  ".swift": "c",
  ".kt": "c",
  ".kts": "c",
  ".java": "c",
  ".ts": "c",
  ".tsx": "c",
  ".js": "c",
  ".jsx": "c",
  ".mjs": "c",
  ".cjs": "c",
  ".mts": "c",
  ".cts": "c",
  ".py": "python",
};

const MAX_CONTENT_LINES = 2;
const MAX_DOCSTRING_LINES = 3;

const DIRECTIVE = /^(MARK:|#?region\b|#?endregion\b|swiftlint:|eslint-|@ts-|prettier-|noqa\b|type:|pylint:|pragma\b|biome-ignore\b)/;
const TICKET = /https?:\/\/|\b[A-Z][A-Z0-9]+-\d+\b|#\d+/;

main();

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const filePath = input?.tool_input?.file_path;
  if (typeof filePath !== "string") return;
  const syntax = SYNTAX[extname(filePath).toLowerCase()];
  if (!syntax) return;

  const cwd = input.cwd ?? process.cwd();
  const absolute = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
  let source;
  try {
    source = readFileSync(absolute, "utf8");
  } catch {
    return;
  }

  const findings = check(source, syntax);
  if (findings.length === 0) return;

  const shown = relative(cwd, absolute) || filePath;
  const lines = findings.map((f) => `${shown}:${f.line} ${f.rule} ${f.message}`);
  const context = [
    "Comment rules (code-comments skill) flagged the last edit. Fix each line in your next edit:",
    ...lines,
  ].join("\n");
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context },
    }),
  );
}

function check(source, syntax) {
  const comments = syntax === "python" ? extractPython(source) : extractCStyle(source);
  const findings = [];
  for (const comment of comments) {
    for (const line of comment.lines) {
      if (DIRECTIVE.test(line.text)) continue;
      const prose = withoutCodeAndUrls(line.text);
      if (/[—–]/.test(prose)) {
        findings.push({ line: line.number, rule: "em-dash", message: "Replace the dash with a period or a comma." });
      }
      if (prose.includes(";")) {
        findings.push({ line: line.number, rule: "semicolon", message: "Split the comment into two sentences." });
      }
      if (/\b(TODO|FIXME)\b/.test(line.text) && !TICKET.test(line.text)) {
        findings.push({ line: line.number, rule: "todo-link", message: "Add a ticket or issue link on the same line." });
      }
    }
  }
  for (const group of groupComments(comments)) {
    if (group.exempt) continue;
    const limit = group.kind === "docstring" ? MAX_DOCSTRING_LINES : MAX_CONTENT_LINES;
    if (group.count > limit) {
      findings.push({
        line: group.start,
        rule: "too-long",
        message: `Comment spans ${group.count} lines, the limit is ${limit}. Keep one summary line plus one link line.`,
      });
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}

// Removes inline code spans, URLs and HTML entities so their punctuation is not judged as prose.
function withoutCodeAndUrls(text) {
  return text
    .replace(/`[^`]*`/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/&[a-z]+;/gi, "");
}

// Merges adjacent line comments into one group, keeps every block comment and docstring as its own group.
function groupComments(comments) {
  const groups = [];
  let current = null;
  for (const comment of comments) {
    const countable = comment.lines.filter((l) => !DIRECTIVE.test(l.text));
    if (countable.length === 0) continue;
    const start = countable[0].number;
    const end = countable[countable.length - 1].number;
    const count = comment.kind === "docstring" ? comment.physical : countable.filter((l) => l.text.trim() !== "").length;
    if (comment.kind === "line" && current && current.kind === "line" && current.end + 1 === start) {
      current.end = end;
      current.count += count;
      continue;
    }
    current = { kind: comment.kind, start, end, count, exempt: comment.exempt };
    groups.push(current);
  }
  return groups;
}

// Walks C-style source and yields line comments and block comments with their content lines.
function extractCStyle(source) {
  const comments = [];
  let i = 0;
  let line = 1;
  let firstCodeSeen = false;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(source, i, ch, () => line++);
      firstCodeSeen = true;
      continue;
    }
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      const text = source.slice(i, stop).replace(/^\/\/+\s?/, "");
      comments.push({ kind: "line", exempt: !firstCodeSeen && line === 1, lines: [{ number: line, text }] });
      i = stop;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      const raw = source.slice(i, stop);
      const startLine = line;
      const lines = [];
      raw.split("\n").forEach((part, index) => {
        const text = part.replace(/^\s*\/\*+\s?/, "").replace(/\*\/\s*$/, "").replace(/^\s*\*\s?/, "");
        if (text.trim() !== "") lines.push({ number: startLine + index, text });
      });
      comments.push({ kind: "block", exempt: !firstCodeSeen && startLine === 1, lines });
      line += (raw.match(/\n/g) || []).length;
      i = stop;
      continue;
    }
    if (!/\s/.test(ch)) firstCodeSeen = true;
    i++;
  }
  return comments;
}

// Walks Python source and yields hash comments and docstrings with their content lines.
function extractPython(source) {
  const comments = [];
  const lines = source.split("\n");
  let i = 0;
  let previousCode = "";
  let onlyHeaderSoFar = true;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const number = i + 1;
    if (trimmed === "") {
      i++;
      continue;
    }
    if (trimmed.startsWith("#")) {
      const text = trimmed.replace(/^#+\s?/, "");
      const isShebang = number === 1 && trimmed.startsWith("#!");
      comments.push({ kind: "line", exempt: onlyHeaderSoFar, lines: isShebang ? [] : [{ number, text }] });
      i++;
      continue;
    }
    const quote = trimmed.match(/^(?:[rRuUbBfF]{0,2})("""|''')/);
    if (quote && (previousCode === "" || /:\s*$/.test(previousCode))) {
      const q = quote[1];
      const openEnd = raw.indexOf(q) + 3;
      let closeIndex = raw.indexOf(q, openEnd);
      let j = i;
      const contentLines = [];
      let physical = 0;
      while (closeIndex === -1 && j + 1 < lines.length) {
        j++;
        closeIndex = lines[j].indexOf(q);
      }
      for (let k = i; k <= j; k++) {
        let text = lines[k];
        if (k === i) text = text.slice(openEnd);
        if (k === j) text = text.slice(0, closeIndex === -1 ? undefined : closeIndex);
        const isDelimiterOnly = text.trim() === "" && (k === i || k === j);
        if (!isDelimiterOnly) physical++;
        if (text.trim() !== "") contentLines.push({ number: k + 1, text: text.trim() });
      }
      comments.push({ kind: "docstring", exempt: false, physical, lines: contentLines });
      onlyHeaderSoFar = false;
      previousCode = "";
      i = j + 1;
      continue;
    }
    const inline = inlineHashComment(raw);
    if (inline !== null) {
      comments.push({ kind: "line", exempt: false, lines: [{ number, text: inline }] });
    }
    onlyHeaderSoFar = false;
    previousCode = stripInlineComment(raw).trim();
    i++;
  }
  return comments;
}

// Returns the text of a trailing hash comment on a code line, or null when the hash sits inside a string.
function inlineHashComment(rawLine) {
  let quote = null;
  for (let i = 0; i < rawLine.length; i++) {
    const ch = rawLine[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#") return rawLine.slice(i).replace(/^#+\s?/, "");
  }
  return null;
}

function stripInlineComment(rawLine) {
  const comment = inlineHashComment(rawLine);
  if (comment === null) return rawLine;
  return rawLine.slice(0, rawLine.lastIndexOf("#" + comment.replace(/^\s/, "")));
}

// Skips a string literal, counting newlines inside multi-line literals, and returns the index after it.
function skipString(source, start, quote, onNewline) {
  const triple = source.startsWith(quote.repeat(3), start);
  const closer = triple ? quote.repeat(3) : quote;
  let i = start + closer.length;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "\n") {
      if (!triple && quote !== "`") return i;
      onNewline();
    }
    if (source.startsWith(closer, i)) return i + closer.length;
    i++;
  }
  return i;
}

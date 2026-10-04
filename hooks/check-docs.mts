#!/usr/bin/env node

// Scans the documentation file an Edit or Write touched for project-docs rule violations and reports them to Claude.
// https://code.claude.com/docs/en/hooks.md

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Configuration } from 'markdownlint';

/** What the PostToolUse hook receives on stdin, the fields this hook reads. */
type HookInput = {
  cwd?: string;
  tool_input?: {
    file_path?: unknown;
  };
};

/** One source line, marked as front matter, a fence marker, the code inside a fence, or prose. */
type Line = {
  number: number;
  text: string;
  kind: 'frontmatter' | 'fence' | 'code' | 'prose';
};

/** The target of an inline link, an image or a link definition as written, with the line it stands on. */
type Link = {
  line: number;
  target: string;
};

/** The file under check with the project root every root-relative rule resolves against. */
type Document = {
  root: string;
  absolute: string;
  segments: string[];
  lines: Line[];
};

/** The rule is one of this hook or the rule name markdownlint reports. */
type Finding = {
  line: number;
  rule: string;
  message: string;
};

/** Lints the text of one file and returns what markdownlint reports. */
type Linter = (text: string) => Finding[];

/** The configuration files looked for in the project root, the first hit wins. */
const CONFIG_FILES = ['.markdownlint.jsonc', '.markdownlint.json'];

/** Files that count as documentation only in the project root. */
const ROOT_FILES = new Set([
  'CONTRIBUTING.md',
  'ARCHITECTURE.md',
  'SECURITY.md',
]);

/** Files that follow a format of their own and never count as documentation. */
const OWN_FORMAT_FILES = new Set([
  'SKILL.md',
  'CLAUDE.md',
  'AGENTS.md',
  'CONTEXT.md',
  'CHANGELOG.md',
]);

/**
 * Matches the line that opens or closes a code fence, also inside a list item or a quote, and captures its marker and its info string.
 * @see {@link https://spec.commonmark.org/0.31.2/#fenced-code-blocks | CommonMark, fenced code blocks}
 */
const FENCE = /^[\s>]*(`{3,}|~{3,})\s*(\S*)/;

/** Matches a level-one heading that carries text. */
const TITLE = /^#\s+\S/;

/** Matches a badge, an image or an HTML line, which may stand between the title and the opening sentence. */
const DECORATION = /^(\[!\[|!\[|<)/;

/** Matches the start of a heading, a table, a quote, a list, a rule or a link definition, the blocks that are no paragraph. */
const BLOCK_START = /^(#|\||>|[-*+]\s|\d+[.)]\s|[-*_]{3,}\s*$|\[[^\]]+\]:)/;

/**
 * Captures the target of every inline link and image on a line, in angle brackets or bare with balanced parentheses, its title left out.
 * @see {@link https://spec.commonmark.org/0.31.2/#links | CommonMark, links}
 */
const LINK_TARGET = /\]\(\s*(?:<([^>\n]*)>|((?:[^()\s]|\([^()\s]*\))+))/g;

/**
 * Captures the target of a link reference definition, in angle brackets or bare, and leaves a footnote alone.
 * @see {@link https://spec.commonmark.org/0.31.2/#link-reference-definitions | CommonMark, link reference definitions}
 */
const LINK_DEFINITION = /^\s*\[(?!\^)[^\]]+\]:\s*(?:<([^>\n]*)>|(\S+))/;

/**
 * Matches a target that starts with a URI scheme or with two slashes, which is no path in the project.
 * @see {@link https://www.rfc-editor.org/rfc/rfc3986.txt | RFC 3986, section 3.1}
 */
const SCHEME = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

await main();

async function main(): Promise<void> {
  // 1. Read the hook input from stdin and stay silent when it is no JSON or names no file.
  let input: HookInput;

  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return;
  }

  const filePath = input?.tool_input?.file_path;

  if (typeof filePath !== 'string') {
    return;
  }

  // 2. Stay silent for a file outside the documentation list and for one that cannot be read.
  const root = input.cwd ?? process.cwd();
  const absolute = resolve(root, filePath);
  const segments = segmentsBelow(root, absolute);

  if (segments === null || !isDocumentation(segments)) {
    return;
  }

  let source: string;

  try {
    source = readFileSync(absolute, 'utf8');
  } catch {
    return;
  }

  // 3. Collect the findings of the own rules and of markdownlint.
  const findings = [
    ...check({ root, absolute, segments, lines: classify(source) }),
    ...(await lintWithMarkdownlint(root, source)),
  ].sort((a, b) => a.line - b.line);

  if (findings.length === 0) {
    return;
  }

  // 4. Hand the findings to Claude as additional context, which informs and never blocks the edit.
  // https://code.claude.com/docs/en/hooks.md#posttooluse-decision-control
  const shown = segments.join('/');
  const lines = findings.map(f => `${shown}:${f.line} ${f.rule} ${f.message}`);
  const context = [
    'Documentation rules (project-docs skill) flagged the last edit. Fix each line in your next edit:',
    ...lines,
  ].join('\n');

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: context,
      },
    }),
  );
}

/** Matches the path below the root against the fixed list of documentation files. */
function isDocumentation(segments: string[]): boolean {
  const name = segments[segments.length - 1];

  if (!name.toLowerCase().endsWith('.md') || OWN_FORMAT_FILES.has(name)) {
    return false;
  }

  if (segments.some(s => s.startsWith('.') || s === 'node_modules')) {
    return false;
  }

  if (name === 'README.md') {
    return true;
  }

  if (segments[0] === 'docs') {
    return segments[1] !== 'adr';
  }

  return segments.length === 1 && ROOT_FILES.has(name);
}

/** Returns the segments of the path below the root, or null for a file outside it, which on Windows may sit on another drive. */
function segmentsBelow(root: string, absolute: string): string[] | null {
  const path = relative(root, absolute);

  return path.startsWith('..') || isAbsolute(path) ? null : path.split(sep);
}

/** Returns what markdownlint reports, nothing in a project without it, and one finding when it cannot run. */
async function lintWithMarkdownlint(
  root: string,
  source: string,
): Promise<Finding[]> {
  try {
    const lint = await createLinter(root);

    return lint === null ? [] : lint(source);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return [
      {
        line: 1,
        rule: 'markdownlint',
        message: `markdownlint could not run, check its configuration. ${reason.replace(/\s+/g, ' ')}`,
      },
    ];
  }
}

/** Builds the lint function from the markdownlint of the project and its configuration, or returns null when either is missing. */
async function createLinter(root: string): Promise<Linter | null> {
  // 1. Find the configuration and the library in the project, without both there is nothing to lint with.
  const configFile = CONFIG_FILES.map(name => join(root, name)).find(
    existsSync,
  );

  const library = resolveLibrary(root);

  if (configFile === undefined || library === null) {
    return null;
  }

  // 2. Import the library by its resolved file URL, a bare import would search next to this hook.
  // https://nodejs.org/api/esm.md#file-urls
  const { lint, readConfig } = (await import(
    pathToFileURL(library).href
  )) as typeof import('markdownlint/sync');

  // 3. Read the configuration with a parser for JSON that carries comments, which JSON.parse rejects.
  // https://raw.githubusercontent.com/DavidAnson/markdownlint/main/README.md
  const config = readConfig(configFile, [parseJsonc]);

  return text =>
    (lint({ strings: { text }, config }).text ?? []).map(error => ({
      line: error.lineNumber,
      rule: error.ruleNames.join('/'),
      message: error.errorDetail
        ? `${error.ruleDescription}. ${error.errorDetail}`
        : `${error.ruleDescription}.`,
    }));
}

/**
 * Resolves markdownlint from the dependencies of the project, because the hook runs from the plugin folder, which has none.
 * @see {@link https://nodejs.org/api/module.md#modulecreaterequirefilename | Node.js, module.createRequire}
 */
function resolveLibrary(root: string): string | null {
  const require = createRequire(join(root, 'package.json'));

  try {
    return require.resolve('markdownlint/sync');
  } catch {
    return null;
  }
}

/** Parses JSON that carries comments and trailing commas, a string that holds such characters stays as it is. */
function parseJsonc(text: string): Configuration {
  const keepStrings = (match: string) => (match.startsWith('"') ? match : '');
  const json = text
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, keepStrings)
    .replace(/"(?:\\.|[^"\\])*"|,(?=\s*[}\]])/g, keepStrings);

  return JSON.parse(json);
}

/** Applies the rules this hook owns, markdownlint reports the rest. */
function check(document: Document): Finding[] {
  return [
    ...checkProse(document.lines),
    ...checkLinks(document),
    ...checkLead(document.lines),
    ...checkReachable(document),
  ];
}

/** Splits the source into lines and marks front matter at the top of the file, fences and the code between them. */
function classify(source: string): Line[] {
  const lines: Line[] = [];
  const texts = source.split('\n');
  const frontmatterEnd = frontmatterEndOf(texts);
  let fence: string | null = null;

  texts.forEach((text, index) => {
    const number = index + 1;
    const marker = text.match(FENCE);

    if (index <= frontmatterEnd) {
      lines.push({ number, text, kind: 'frontmatter' });

      return;
    }

    if (fence === null && marker) {
      fence = marker[1];
      lines.push({ number, text, kind: 'fence' });

      return;
    }

    if (fence !== null && marker && closesFence(marker, fence)) {
      fence = null;
      lines.push({ number, text, kind: 'fence' });

      return;
    }

    lines.push({ number, text, kind: fence === null ? 'prose' : 'code' });
  });

  return lines;
}

/**
 * Tells whether the marker closes the open fence, which takes the same character, at least its length and no info string.
 * @see {@link https://spec.commonmark.org/0.31.2/#fenced-code-blocks | CommonMark, fenced code blocks}
 */
function closesFence(marker: RegExpMatchArray, open: string): boolean {
  const sameCharacter = marker[1][0] === open[0];

  return sameCharacter && marker[1].length >= open.length && marker[2] === '';
}

/** Returns the index of the line that closes the front matter, or -1 when the file opens with none or never closes it. */
function frontmatterEndOf(texts: string[]): number {
  if (texts[0]?.trim() !== '---') {
    return -1;
  }

  return texts.findIndex((text, index) => index > 0 && text.trim() === '---');
}

/** Reports every dash and every semicolon in the prose lines, code and link targets left out. */
function checkProse(lines: Line[]): Finding[] {
  const findings: Finding[] = [];

  for (const line of lines) {
    if (line.kind !== 'prose') {
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
        message: 'Split the sentence into two sentences.',
      });
    }
  }

  return findings;
}

/** Removes inline code spans, link targets, URLs and HTML entities so their punctuation is not judged as prose. */
function withoutCodeAndUrls(text: string): string {
  return text
    .replace(/`[^`]*`/g, '')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/^\s*\[(?!\^)[^\]]+\]:\s*\S+/, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/&#?[a-z0-9]+;/gi, '');
}

/** Reports every relative link whose target does not exist on disk. */
function checkLinks(document: Document): Finding[] {
  const findings: Finding[] = [];

  for (const link of linksOf(document.lines)) {
    const target = resolveTarget(link.target, document.absolute, document.root);

    if (target !== null && !existsSync(target)) {
      findings.push({
        line: link.line,
        rule: 'dead-link',
        message: `Link target ${link.target} does not exist.`,
      });
    }
  }

  return findings;
}

/** Collects the targets of inline links, images and link definitions outside code. */
function linksOf(lines: Line[]): Link[] {
  const links: Link[] = [];

  for (const line of lines) {
    if (line.kind !== 'prose') {
      continue;
    }

    const text = line.text.replace(/`[^`]*`/g, '');
    const definition = text.match(LINK_DEFINITION);

    for (const match of text.matchAll(LINK_TARGET)) {
      links.push({ line: line.number, target: match[1] ?? match[2] });
    }

    if (definition) {
      links.push({ line: line.number, target: definition[1] ?? definition[2] });
    }
  }

  return links;
}

/** Collects the link targets of a file, none when the file cannot be read. */
function linksOfFile(path: string): Link[] {
  try {
    return linksOf(classify(readFileSync(path, 'utf8')));
  } catch {
    return [];
  }
}

/**
 * Returns the path a relative link points at, a leading slash meaning the project root, or null for a URL and a bare anchor.
 * @see {@link https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax.md#relative-links | GitHub Docs, relative links}
 */
function resolveTarget(
  target: string,
  from: string,
  root: string,
): string | null {
  if (SCHEME.test(target)) {
    return null;
  }

  const path = target.replace(/[#?].*$/, '');

  if (path === '') {
    return null;
  }

  const decoded = decode(path);

  return decoded.startsWith('/')
    ? join(root, decoded)
    : resolve(dirname(from), decoded);
}

/** Decodes percent escapes such as %20, a malformed escape leaves the path as it is. */
function decode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Expects one title as the first content line and a paragraph right under it, decoration lines skipped. */
function checkLead(lines: Line[]): Finding[] {
  const content = lines.filter(
    l => l.kind !== 'frontmatter' && l.text.trim() !== '',
  );

  if (content.length === 0) {
    return [];
  }

  const title = content[0];

  if (title.kind !== 'prose' || !TITLE.test(title.text)) {
    return [
      {
        line: title.number,
        rule: 'lead',
        message: 'Start the file with one # title.',
      },
    ];
  }

  const lead = content.slice(1).find(l => !DECORATION.test(l.text.trim()));
  const isParagraph =
    lead !== undefined &&
    lead.kind === 'prose' &&
    !BLOCK_START.test(lead.text.trim());

  if (isParagraph) {
    return [];
  }

  return [
    {
      line: title.number,
      rule: 'lead',
      message: 'Follow the title with one opening sentence.',
    },
  ];
}

/** Expects a file under docs to be linked from a README in its own folder or in a folder above it. */
function checkReachable(document: Document): Finding[] {
  if (document.segments[0] !== 'docs') {
    return [];
  }

  const readmes = readmesAbove(document).filter(existsSync);

  if (readmes.length === 0) {
    return [];
  }

  const isLinked = readmes.some(readme =>
    linksOfFile(readme).some(
      link =>
        resolveTarget(link.target, readme, document.root) === document.absolute,
    ),
  );

  if (isLinked) {
    return [];
  }

  return [
    {
      line: 1,
      rule: 'unlinked',
      message: 'Link this file from the README table.',
    },
  ];
}

/** Lists the README paths from the folder of the file up to the project root, the file itself left out. */
function readmesAbove(document: Document): string[] {
  const readmes: string[] = [];

  for (let depth = document.segments.length - 1; depth >= 0; depth--) {
    const folder = document.segments.slice(0, depth);
    const readme = join(document.root, ...folder, 'README.md');

    if (readme !== document.absolute) {
      readmes.push(readme);
    }
  }

  return readmes;
}

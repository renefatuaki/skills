// The documentation rules of the project-docs skill and the markdownlint of the project, checked over the changed documentation files of one checkout.
// https://raw.githubusercontent.com/DavidAnson/markdownlint/main/README.md

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Configuration } from 'markdownlint';

import type { Changes } from './changes.mts';
import {
  checkEach,
  type Finding,
  isHidden,
  type RuleSet,
  resolveFromProject,
  segmentsBelow,
} from './hook.mts';
import {
  closesFence,
  FENCE,
  linkTargetsOf,
  resolveTarget,
} from './markdown.mts';

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

/** What the rules report for one document, before the rule set adds the file. The rule is one of this module or the rule name markdownlint reports. */
type DocumentFinding = {
  line: number;
  rule: string;
  message: string;
};

/** Lints the text of one file. A project without markdownlint or its configuration gets a linter that reports nothing, a broken setup one that reports why. */
type Linter = (text: string) => DocumentFinding[];

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

/** Matches a level-one heading that carries text. */
const TITLE = /^#\s+\S/;

/** Matches a badge, an image or an HTML line, which may stand between the title and the opening sentence. */
const DECORATION = /^(\[!\[|!\[|<)/;

/** Matches the start of a heading, a table, a quote, a list, a rule or a link definition, the blocks that are no paragraph. */
const BLOCK_START = /^(#|\||>|[-*+]\s|\d+[.)]\s|[-*_]{3,}\s*$|\[[^\]]+\]:)/;

/**
 * Captures the target of a link reference definition, in angle brackets or bare, and leaves a footnote alone.
 * @see {@link https://spec.commonmark.org/0.31.2/#link-reference-definitions | CommonMark, link reference definitions}
 */
const LINK_DEFINITION = /^\s*\[(?!\^)[^\]]+\]:\s*(?:<([^>\n]*)>|(\S+))/;

/** The documentation rules over every changed file isDocumentation accepts, below the root of the checkout. */
export const docs: RuleSet = {
  heading: 'Documentation rules (project-docs skill)',
  check: checkFiles,
};

/** Builds the linter once for the checkout and runs the own rules and markdownlint over each changed documentation file. */
async function checkFiles(changes: Changes): Promise<Finding[]> {
  const { root, files } = changes;
  const documents = files.filter(file => segmentsOf(root, file) !== null);

  if (documents.length === 0) {
    return [];
  }

  const lint = await createLinter(root);

  return checkEach(changes, documents, async absolute => {
    const segments = segmentsOf(root, absolute);
    let source: string;

    if (segments === null) {
      return [];
    }

    try {
      source = readFileSync(absolute, 'utf8');
    } catch {
      return [];
    }

    const findings = [
      ...check({ root, absolute, segments, lines: classify(source) }),
      ...lint(source),
    ].sort((a, b) => a.line - b.line);

    return findings.map(finding => ({ file: absolute, ...finding }));
  });
}

/** Returns the segments of a documentation file below the root, or null for any other file. */
function segmentsOf(root: string, file: string): string[] | null {
  const segments = segmentsBelow(root, file);

  return segments !== null && isDocumentation(segments) ? segments : null;
}

/** Matches the path below the root against the fixed list of documentation files. */
function isDocumentation(segments: string[]): boolean {
  const name = segments[segments.length - 1];

  if (!name.toLowerCase().endsWith('.md') || OWN_FORMAT_FILES.has(name)) {
    return false;
  }

  if (isHidden(segments)) {
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

/** Builds the linter of the checkout once. A project without markdownlint gets a linter that reports nothing, and a setup that cannot run one that reports why. */
async function createLinter(root: string): Promise<Linter> {
  try {
    const lint = await loadLinter(root);

    return lint === null ? () => [] : text => lintGuarded(lint, text);
  } catch (error) {
    return () => [couldNotRun(error)];
  }
}

/** Runs the linter and turns an error it throws into the one finding that tells why markdownlint could not run. */
function lintGuarded(lint: Linter, text: string): DocumentFinding[] {
  try {
    return lint(text);
  } catch (error) {
    return [couldNotRun(error)];
  }
}

/** Names the reason markdownlint could not run, on the first line of the file. */
function couldNotRun(error: unknown): DocumentFinding {
  const reason = error instanceof Error ? error.message : String(error);

  return {
    line: 1,
    rule: 'markdownlint',
    message: `markdownlint could not run, check its configuration. ${reason.replace(/\s+/g, ' ')}`,
  };
}

/** Builds the lint function from the markdownlint of the project and its configuration, or returns null when either is missing. */
async function loadLinter(root: string): Promise<Linter | null> {
  // 1. Find the configuration and the library in the project, without both there is nothing to lint with.
  const configFile = CONFIG_FILES.map(name => join(root, name)).find(
    existsSync,
  );

  const library = resolveFromProject(root, 'markdownlint/sync');

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

/** Parses JSON that carries comments and trailing commas, a string that holds such characters stays as it is. */
function parseJsonc(text: string): Configuration {
  const keepStrings = (match: string) => (match.startsWith('"') ? match : '');
  const json = text
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, keepStrings)
    .replace(/"(?:\\.|[^"\\])*"|,(?=\s*[}\]])/g, keepStrings);

  return JSON.parse(json);
}

/** Applies the rules this hook owns, markdownlint reports the rest. */
function check(document: Document): DocumentFinding[] {
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
      fence = marker[2];
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

/** Returns the index of the line that closes the front matter, or -1 when the file opens with none or never closes it. */
function frontmatterEndOf(texts: string[]): number {
  if (texts[0]?.trim() !== '---') {
    return -1;
  }

  return texts.findIndex((text, index) => index > 0 && text.trim() === '---');
}

/** Reports every dash and every semicolon in the prose lines, code and link targets left out. */
function checkProse(lines: Line[]): DocumentFinding[] {
  const findings: DocumentFinding[] = [];

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
function checkLinks(document: Document): DocumentFinding[] {
  const findings: DocumentFinding[] = [];

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

    for (const target of linkTargetsOf(text)) {
      links.push({ line: line.number, target });
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

/** Expects one title as the first content line and a paragraph right under it, decoration lines skipped. */
function checkLead(lines: Line[]): DocumentFinding[] {
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
function checkReachable(document: Document): DocumentFinding[] {
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

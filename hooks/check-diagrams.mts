#!/usr/bin/env node

// Parses the Mermaid diagrams of the Markdown file an Edit or Write touched with the Mermaid of the project, and names the diagrams whose table links an edited file.
// https://code.claude.com/docs/en/hooks.md

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  type EditedFile,
  isHidden,
  readEditedFile,
  report,
  resolveFromProject,
} from './lib/hook.mts';
import {
  closesFence,
  FENCE,
  linkTargetsOf,
  resolveTarget,
} from './lib/markdown.mts';

/** One mermaid fence, the line of its opening marker, its source and the rows of the table under it, null without a table. */
type Diagram = {
  line: number;
  body: string[];
  rows: string[] | null;
};

type Finding = {
  line: number;
  rule: string;
  message: string;
};

/** Parses one diagram and returns the error message, or null for a valid one. */
type Parser = (text: string) => Promise<string | null>;

/**
 * The part of the Mermaid API this hook calls, declared here because the types of the package need a dependency it leaves out.
 * @see {@link https://mermaid.js.org/config/usage.html#syntax-validation-without-rendering | Mermaid, syntax validation without rendering}
 */
type Mermaid = {
  parse(text: string): Promise<unknown>;
};

/**
 * Matches the delimiter row of a table, with or without the outer pipes.
 * @see {@link https://github.github.com/gfm/#tables-extension- | GitHub Flavored Markdown, tables}
 */
const DELIMITER_ROW = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;

/** Stands in for DOMPurify, which needs a DOM that Node lacks and which Mermaid calls only to sanitize labels. */
const PURIFY_STUB =
  'data:text/javascript,export default { addHook() {}, removeHook() {}, removeAllHooks() {}, sanitize: text => text }';

await main();

async function main(): Promise<void> {
  // 1. Read the edited file and stay silent for one in a dot folder or in a dependency folder.
  const file = readEditedFile();

  if (file === null || isHidden(file.segments)) {
    return;
  }

  // 2. Parse the diagrams of a Markdown file and find the diagrams that link any other file.
  const shown = file.segments.join('/');
  const findings = isMarkdown(shown)
    ? (await checkSyntax(file.root, diagramsOfFile(file.absolute))).map(
        finding =>
          `${shown}:${finding.line} ${finding.rule} ${finding.message}`,
      )
    : [];

  const linking = diagramsLinking(file);
  const context = [
    ...(findings.length > 0
      ? [
          'Mermaid (diagrams skill) cannot parse the last edit. Fix each line in your next edit:',
          ...findings,
        ]
      : []),
    ...(linking.length > 0
      ? [
          `Diagrams (diagrams skill) link ${shown}. Check that each one still shows what the code does, and update it when it does not:`,
          ...linking,
        ]
      : []),
  ];

  // 3. Hand both lists to Claude, silence when both are empty.
  if (context.length > 0) {
    report(context);
  }
}

function isMarkdown(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

/** Returns what the Mermaid of the project reports, nothing in a project without it, and one finding when it cannot run. */
async function checkSyntax(
  root: string,
  diagrams: Diagram[],
): Promise<Finding[]> {
  if (diagrams.length === 0) {
    return [];
  }

  let parse: Parser | null;

  try {
    parse = await createParser(root);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return [
      {
        line: diagrams[0].line,
        rule: 'mermaid',
        message: `Mermaid could not run, check its installation. ${reason.replace(/\s+/g, ' ')}`,
      },
    ];
  }

  if (parse === null) {
    return [];
  }

  const findings: Finding[] = [];

  for (const diagram of diagrams) {
    const error = await parse(diagram.body.join('\n'));

    if (error !== null) {
      findings.push({
        line: diagram.line + lineOf(error, diagram),
        rule: 'syntax',
        message: error.replace(/\s+/g, ' ').slice(0, 300),
      });
    }
  }

  return findings;
}

/** Returns the line inside the fence the error names, the line of the keyword when it names none. */
function lineOf(error: string, diagram: Diagram): number {
  const named = Number(error.match(/line (\d+)/)?.[1] ?? 1);
  const counted = countedLinesOf(diagram.body);

  return (counted[named - 1] ?? counted.at(-1) ?? 0) + 1;
}

/**
 * Lists the index of every body line Mermaid counts, which leaves out the front matter, the comments and the blank lines before the keyword.
 * @see {@link https://raw.githubusercontent.com/mermaid-js/mermaid/develop/packages/mermaid/src/preprocess.ts | Mermaid, preprocess.ts}
 */
function countedLinesOf(body: string[]): number[] {
  const counted = body
    .map((_, index) => index)
    .slice(frontmatterLengthOf(body))
    .filter(index => !/^\s*%%(?!\{)./.test(body[index]));

  const keyword = counted.findIndex(index => body[index].trim() !== '');

  return counted.slice(Math.max(keyword, 0));
}

/**
 * Returns the number of lines the front matter of the diagram takes, 0 when it opens with none or never closes it.
 * @see {@link https://mermaid.js.org/config/configuration.html | Mermaid, frontmatter config}
 */
function frontmatterLengthOf(body: string[]): number {
  if (body[0]?.trim() !== '---') {
    return 0;
  }

  return (
    body.findIndex((line, index) => index > 0 && line.trim() === '---') + 1
  );
}

/** Builds the parse function from the Mermaid of the project, or returns null when the project has none. */
async function createParser(root: string): Promise<Parser | null> {
  // 1. Find the library in the project, without it there is nothing to parse with.
  const library = resolveFromProject(root, 'mermaid');

  if (library === null) {
    return null;
  }

  // 2. Replace DOMPurify before Mermaid loads, parsing needs no sanitizer and Node has no DOM for it.
  // https://nodejs.org/api/module.md#moduleregisterhooksoptions
  registerHooks({
    resolve: (specifier, context, nextResolve) =>
      specifier === 'dompurify'
        ? { url: PURIFY_STUB, shortCircuit: true }
        : nextResolve(specifier, context),
  });

  // 3. Import the library by its resolved file URL, a bare import would search next to this hook.
  // https://nodejs.org/api/esm.md#file-urls
  const { default: mermaid } = (await import(pathToFileURL(library).href)) as {
    default: Mermaid;
  };

  return async text => {
    try {
      await mermaid.parse(text);

      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
}

/** Lists the diagrams whose table links the edited file, searched in the READMEs above the file and under docs. */
function diagramsLinking({ root, absolute, segments }: EditedFile): string[] {
  const linking: string[] = [];

  for (const document of documentsNear(root, segments)) {
    if (document === absolute) {
      continue;
    }

    for (const diagram of diagramsOfFile(document)) {
      const links = (diagram.rows ?? [])
        .flatMap(row => linkTargetsOf(row))
        .map(target => resolveTarget(target, document, root));

      if (links.includes(absolute)) {
        const shown = relative(root, document).split(sep).join('/');

        linking.push(`${shown}:${diagram.line} linked`);
      }
    }
  }

  return linking;
}

/** Lists the README of every folder from the file up to the root and every Markdown file under docs. */
function documentsNear(root: string, segments: string[]): string[] {
  const readmes = segments.map((_, depth) =>
    join(root, ...segments.slice(0, depth), 'README.md'),
  );

  return [
    ...new Set([
      ...readmes.filter(existsSync),
      ...markdownUnder(join(root, 'docs')),
    ]),
  ];
}

/** Lists every Markdown file below the folder, none when the folder is missing. */
function markdownUnder(folder: string): string[] {
  try {
    return readdirSync(folder, { recursive: true, encoding: 'utf8' })
      .filter(isMarkdown)
      .sort()
      .map(path => join(folder, path));
  } catch {
    return [];
  }
}

/** Collects the diagrams of a file, none when the file cannot be read. */
function diagramsOfFile(path: string): Diagram[] {
  try {
    return diagramsOf(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
}

/** Collects every fence with the info string mermaid. */
function diagramsOf(source: string): Diagram[] {
  const texts = source.split(/\r?\n/);
  const diagrams: Diagram[] = [];
  let open: { index: number; fence: RegExpMatchArray } | null = null;

  for (const [index, text] of texts.entries()) {
    const fence = text.match(FENCE);

    if (open === null) {
      open = fence ? { index, fence } : null;

      continue;
    }

    if (!fence || !closesFence(fence, open.fence[2])) {
      continue;
    }

    if (open.fence[3] === 'mermaid') {
      diagrams.push(diagramBetween(texts, open.index, index));
    }

    open = null;
  }

  return diagrams;
}

/** Builds the diagram from the lines between its opening marker and the line that closes it, the indent of a list item or a quote taken off. */
function diagramBetween(
  texts: string[],
  opening: number,
  closing: number,
): Diagram {
  const indent = texts[opening].match(FENCE)?.[1].length ?? 0;
  const prefix = new RegExp(`^[\\s>]{0,${indent}}`);
  const body = texts
    .slice(opening + 1, closing)
    .map(line => line.replace(prefix, ''));

  return {
    line: opening + 1,
    body,
    rows: rowsAfter(texts, closing + 1),
  };
}

/** Returns the body rows of the table that follows the fence with only blank lines between them, the indent of a quote taken off, null when another block follows. */
function rowsAfter(texts: string[], from: number): string[] | null {
  const lines = texts.map(text => text.replace(/^[\s>]+/, '').trimEnd());
  const start = lines.findIndex((line, index) => index >= from && line !== '');
  const header = lines[start] ?? '';
  const delimiter = lines[start + 1] ?? '';
  const isTable =
    header.includes('|') &&
    DELIMITER_ROW.test(delimiter) &&
    cellsOf(header).length === cellsOf(delimiter).length;

  if (!isTable) {
    return null;
  }

  const end = lines.findIndex(
    (line, index) => index > start + 1 && !line.includes('|'),
  );

  return lines.slice(start + 2, end === -1 ? undefined : end);
}

/** Splits a table row into its cells, the outer pipes left out. */
function cellsOf(row: string): string[] {
  return row.replace(/^\|/, '').replace(/\|$/, '').split('|');
}

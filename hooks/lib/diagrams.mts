// The diagram checks of the diagrams skill over one checkout, the Mermaid syntax of every changed Markdown file and the diagrams whose table links a changed file.
// https://mermaid.js.org/config/usage.html#syntax-validation-without-rendering

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

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

/** One mermaid fence, the line of its opening marker, its source and the rows of the table under it, null without a table. */
type Diagram = {
  line: number;
  body: string[];
  rows: string[] | null;
};

/** What the Mermaid of the project reports for one diagram, before the rule set adds the file. */
type SyntaxFinding = {
  line: number;
  rule: string;
  message: string;
};

/** Parses the diagrams of one file and returns what Mermaid reports. A project without Mermaid gets a check that reports nothing, a broken install one that reports why. */
type SyntaxCheck = (diagrams: Diagram[]) => Promise<SyntaxFinding[]>;

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

// Replaces DOMPurify once per process before any Mermaid loads, parsing needs no sanitizer and Node has no DOM for it.
// https://nodejs.org/api/module.md#moduleregisterhooksoptions
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === 'dompurify'
      ? { url: PURIFY_STUB, shortCircuit: true }
      : nextResolve(specifier, context),
});

/** Mermaid syntax over every changed Markdown file outside a dot folder or a dependency folder. */
export const diagramSyntax: RuleSet = {
  heading: 'Mermaid syntax (diagrams skill)',
  check: checkSyntax,
};

/** The diagrams in the READMEs above a changed file and in the docs folders beside them whose table links a changed file, deleted files included. A diagram whose own file changed is left out. */
export const linkedDiagrams: RuleSet = {
  heading:
    'Diagrams that link a changed file (diagrams skill). Check that each one still shows what the code does, and update it when it does not',
  check: checkLinked,
};

/** Builds the Mermaid of the checkout once and parses every diagram of each changed Markdown file. */
async function checkSyntax(changes: Changes): Promise<Finding[]> {
  const { root, files } = changes;
  const documents = files.filter(
    file => isCheckable(root, file) && diagramsOfFile(file).length > 0,
  );

  if (documents.length === 0) {
    return [];
  }

  const check = await createSyntaxCheck(root);

  return checkEach(changes, documents, async file => {
    const findings = await check(diagramsOfFile(file));

    return findings.map(finding => ({ file, ...finding }));
  });
}

/** Reads every candidate document once, resolves the links of its diagram tables and reports each diagram that links a changed file. */
async function checkLinked(changes: Changes): Promise<Finding[]> {
  const { root } = changes;
  const changed = new Set(changes.files.filter(file => isLinkable(root, file)));
  const documents = documentsNear(root, [...changed]).filter(
    document => !changed.has(document),
  );

  return checkEach(changes, documents, async document => {
    const findings: Finding[] = [];

    for (const diagram of diagramsOfFile(document)) {
      const links = (diagram.rows ?? [])
        .flatMap(row => linkTargetsOf(row))
        .map(target => resolveTarget(target, document, root));

      const linked = [...changed].filter(file => links.includes(file));

      if (linked.length > 0) {
        findings.push({
          file: document,
          line: diagram.line,
          rule: 'linked',
          message: linked.map(file => displayPathOf(root, file)).join(', '),
        });
      }
    }

    return findings;
  });
}

/** Tells whether the file is a Markdown file below the root outside a dot folder and a dependency folder. */
function isCheckable(root: string, file: string): boolean {
  return isMarkdown(file) && isLinkable(root, file);
}

/** Tells whether the file lies below the root outside a dot folder and a dependency folder, which is where a diagram table may link to. */
function isLinkable(root: string, file: string): boolean {
  const segments = segmentsBelow(root, file);

  return segments !== null && !isHidden(segments);
}

function isMarkdown(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

/** Shows the file below the root with slashes. */
function displayPathOf(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
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

/** Builds the syntax check from the Mermaid of the project, or one that reports nothing when the project has none. */
async function createSyntaxCheck(root: string): Promise<SyntaxCheck> {
  // 1. Find the library in the project, without it there is nothing to parse with.
  const library = resolveFromProject(root, 'mermaid');

  if (library === null) {
    return async () => [];
  }

  // 2. Import the library by its resolved file URL, a bare import would search next to this hook.
  // https://nodejs.org/api/esm.md#file-urls
  let mermaid: Mermaid;

  try {
    mermaid = (
      (await import(pathToFileURL(library).href)) as {
        default: Mermaid;
      }
    ).default;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return async diagrams => [
      {
        line: diagrams[0].line,
        rule: 'mermaid',
        message: `Mermaid could not run, check its installation. ${reason.replace(/\s+/g, ' ')}`,
      },
    ];
  }

  // 3. Parse each diagram and place the error on the line it names.
  return async diagrams => {
    const findings: SyntaxFinding[] = [];

    for (const diagram of diagrams) {
      const error = await syntaxErrorOf(mermaid, diagram.body.join('\n'));

      if (error !== null) {
        findings.push({
          line: diagram.line + lineOf(error, diagram),
          rule: 'syntax',
          message: error.replace(/\s+/g, ' ').slice(0, 300),
        });
      }
    }

    return findings;
  };
}

/** Parses one diagram and returns the error message, or null for a valid one. */
async function syntaxErrorOf(
  mermaid: Mermaid,
  text: string,
): Promise<string | null> {
  try {
    await mermaid.parse(text);

    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Lists the README of every folder from each changed file up to the root, then every Markdown file in the docs folder of one of those folders, each once. */
function documentsNear(root: string, changed: string[]): string[] {
  const folders = new Set([
    root,
    ...changed.flatMap(file => {
      const segments = segmentsBelow(root, file) ?? [];

      return segments.map((_, depth) =>
        join(root, ...segments.slice(0, depth)),
      );
    }),
  ]);

  return [
    ...new Set([
      ...[...folders]
        .map(folder => join(folder, 'README.md'))
        .filter(existsSync),
      ...[...folders].flatMap(folder => markdownUnder(join(folder, 'docs'))),
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

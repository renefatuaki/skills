#!/usr/bin/env node

// Runs the diagram rules over the fixture project, once with the Mermaid of this repository and once in a project without one, and compares the findings with the expected ones.

import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { diagramSyntax, linkedDiagrams } from '../hooks/lib/diagrams.mts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'tests', 'fixtures', 'diagrams');

const EXPECTED: Record<string, string[]> = {
  'README.md': [],
  'src/orders/README.md': [],
  'docs/architecture.md': [],
  'docs/types.md': [],
  'docs/edge.md': [],
  'notes.md': [],
  'docs/bad.md': ['docs/bad.md:10 syntax', 'docs/bad.md:21 syntax'],
  'docs/README.md': [],
  'docs/schema.sql': ['docs/README.md:5 linked'],
  'src/orders/checkout.ts': [
    'src/orders/README.md:5 linked',
    'docs/architecture.md:5 linked',
    'docs/bad.md:5 linked',
    'docs/types.md:28 linked',
  ],
  'src/orders/payment.ts': ['src/orders/README.md:5 linked'],
  'src/orders/edge.ts': [
    'docs/edge.md:5 linked',
    'docs/edge.md:23 linked',
    'docs/edge.md:46 linked',
    'docs/edge.md:56 linked',
  ],
  'src/orders/unlinked.ts': [],
  'docs/missing.md': [],
};

/** What the rules report where the project has no Mermaid to parse with, no syntax finding and the same links. */
const EXPECTED_WITHOUT_MERMAID: Record<string, string[]> = {
  'docs/bad.md': [],
  'src/orders/checkout.ts': EXPECTED['src/orders/checkout.ts'],
};

// A folder outside this repository resolves no Mermaid, inside it Node finds the one of the repository.
const bare = mkdtempSync(join(tmpdir(), 'diagrams-'));

cpSync(fixture, bare, { recursive: true });

const failures =
  (await compare('diagrams', fixture, EXPECTED)) +
  (await compare('diagrams-without-mermaid', bare, EXPECTED_WITHOUT_MERMAID));

rmSync(bare, { recursive: true });

console.log(
  failures === 0 ? 'All fixtures pass.' : `${failures} fixture(s) failed.`,
);

process.exit(failures === 0 ? 0 : 1);

/** Runs every file of the project through the rules, prints one line per file and returns the number of mismatches. */
async function compare(
  label: string,
  project: string,
  files: Record<string, string[]>,
): Promise<number> {
  let mismatches = 0;

  for (const [name, expected] of Object.entries(files)) {
    const actual = await run(project, name);
    const ok = JSON.stringify(actual) === JSON.stringify(expected);

    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}/${name}`);

    if (!ok) {
      mismatches++;
      console.log(
        `  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`,
      );
    }
  }

  return mismatches;
}

/** Checks one file as the turn hook checks a changed file of its project and returns "path:line rule" entries. */
async function run(project: string, name: string): Promise<string[]> {
  const changes = { root: project, files: [join(project, name)] };
  const findings = [
    ...(await diagramSyntax.check(changes)),
    ...(await linkedDiagrams.check(changes)),
  ];

  return findings.map(finding => {
    const path = relative(project, finding.file).split(sep).join('/');

    return `${path}:${finding.line} ${finding.rule}`;
  });
}

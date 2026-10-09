#!/usr/bin/env node

// Runs the documentation check hook over the fixture projects, which differ in their markdownlint configuration, and compares the findings with the expected ones.

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hooks = join(root, 'plugins', 'clean-code', 'hooks');
const script = join(hooks, 'check-docs.mts');
const fixtures = join(root, 'tests', 'fixtures');

const EXPECTED: Record<string, Record<string, string[]>> = {
  'project-docs': {
    'README.md': [],
    'docs/setup.md': [],
    'docs/bad.md': [
      '3 em-dash',
      '5 semicolon',
      '7 MD040/fenced-code-language',
      '8 MD014/commands-show-output',
      '11 dead-link',
    ],
    'docs/no-lead.md': ['1 lead'],
    'docs/orphan.md': ['1 unlinked'],
    'docs/links.md': [],
    'docs/nested.md': [],
    'docs/adr/0001-example.md': [],
    'notes.md': [],
    'docs/missing.md': [],
  },
  'project-docs-without-markdownlint': {
    'docs/bad.md': ['3 em-dash', '5 semicolon', '11 dead-link'],
    'docs/links.md': ['7 dead-link'],
    'docs/lead-rule.md': ['1 lead'],
    'docs/lead-definition.md': ['1 lead'],
    'docs/open-frontmatter.md': ['1 lead', '7 semicolon'],
  },
  'project-docs-broken-markdownlint': {
    'docs/bad.md': ['1 markdownlint', '3 semicolon'],
  },
  'project-docs-jsonc': {
    'docs/bad.md': ['5 MD040/fenced-code-language'],
  },
};

let failures = 0;

for (const [project, files] of Object.entries(EXPECTED)) {
  for (const [name, expected] of Object.entries(files)) {
    const actual = run(join(fixtures, project), name);
    const ok = JSON.stringify(actual) === JSON.stringify(expected);

    if (!ok) {
      failures++;
    }

    console.log(`${ok ? 'PASS' : 'FAIL'} ${project}/${name}`);

    if (!ok) {
      console.log(
        `  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`,
      );
    }
  }
}

console.log(
  failures === 0 ? 'All fixtures pass.' : `${failures} fixture(s) failed.`,
);

process.exit(failures === 0 ? 0 : 1);

/** Feeds one fixture through the hook with its project as working directory and returns "line rule" pairs. */
function run(project: string, filePath: string): string[] {
  const input = JSON.stringify({
    cwd: project,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: filePath },
  });

  const result = spawnSync('node', [script], { input, encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(`hook exited with ${result.status}: ${result.stderr}`);
  }

  if (result.stdout.trim() === '') {
    return [];
  }

  const context: string = JSON.parse(result.stdout).hookSpecificOutput
    .additionalContext;

  return context
    .split('\n')
    .slice(1)
    .flatMap(line => {
      const match = line.match(/:(\d+) (\S+) /);

      return match ? [`${match[1]} ${match[2]}`] : [];
    });
}

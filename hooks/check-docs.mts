#!/usr/bin/env node

// Scans the documentation file an Edit or Write touched for project-docs rule violations and reports them to Claude.
// https://code.claude.com/docs/en/hooks.md

import { docs } from './lib/docs.mts';
import { readEditedFile, report } from './lib/hook.mts';

await main();

async function main(): Promise<void> {
  // 1. Read the edited file and stay silent for one outside the project.
  const file = readEditedFile();

  if (file === null) {
    return;
  }

  // 2. Collect the findings of the documentation rules.
  const findings = await docs.check({
    root: file.root,
    files: [file.absolute],
  });

  if (findings.length === 0) {
    return;
  }

  // 3. Hand the findings to Claude, one line each.
  const shown = file.segments.join('/');
  const lines = findings.map(f => `${shown}:${f.line} ${f.rule} ${f.message}`);

  report([
    'Documentation rules (project-docs skill) flagged the last edit. Fix each line in your next edit:',
    ...lines,
  ]);
}

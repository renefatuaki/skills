#!/usr/bin/env node

// Scans the file an Edit or Write touched for comment rule violations and reports them to Claude.
// https://code.claude.com/docs/en/hooks.md

import { relative } from 'node:path';

import { comments } from './lib/comments.mts';
import { readEditedPath, report } from './lib/hook.mts';

await main();

async function main(): Promise<void> {
  // 1. Read the edited path and stay silent when the input names none.
  const edited = readEditedPath();

  if (edited === null) {
    return;
  }

  // 2. Collect the findings of the comment rules.
  const findings = await comments.check({
    root: edited.root,
    files: [edited.absolute],
  });

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

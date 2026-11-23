#!/usr/bin/env node

// Fails when the text of a skill has the agent run `rm -rf`, which the user's settings deny, instead of handing it to the user as a `! rm -rf` line.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USER_COMMAND = /`! [^`]*`/g;

const skillTexts = execFileSync(
  'git',
  ['ls-files', ':(glob)plugins/*/skills/**/*.md'],
  { cwd: root, encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean);

const errors = skillTexts.flatMap(path =>
  readFileSync(join(root, path), 'utf8')
    .split('\n')
    .flatMap((line, index) =>
      line.replace(USER_COMMAND, '').includes('rm -rf')
        ? [
            `${path}:${index + 1} runs rm -rf, hand it to the user as one \`! rm -rf <path>\` line instead`,
          ]
        : [],
    ),
);

for (const error of errors) {
  console.error(error);
}

if (errors.length === 0) {
  console.log(`no skill runs rm -rf, checked ${skillTexts.length} skill texts`);
}

process.exit(errors.length === 0 ? 0 : 1);

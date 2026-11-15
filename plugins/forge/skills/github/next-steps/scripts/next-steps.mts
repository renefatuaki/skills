#!/usr/bin/env node

// Prints the open pull requests of the repository as a numbered list in the order to work them, each with its next action, the list the next-steps skill starts from.

import { execFileSync } from 'node:child_process';

import { STEPS_QUERY, parseSteps, stepList } from './steps.mts';

// gh fills {owner} and {repo} from the repository of the current directory.
// https://cli.github.com/manual/gh_api
const rows = parseSteps(
  gh([
    'api',
    'graphql',
    '-f',
    `query=${STEPS_QUERY}`,
    '-F',
    'owner={owner}',
    '-F',
    'name={repo}',
  ]),
);

if (rows === null) {
  fail('GitHub gave no pull requests.');
}

console.log(rows.length === 0 ? 'No open pull requests.' : stepList(rows));

/**
 * Runs gh and returns its stdout, while its stderr goes straight to the terminal.
 * @see {@link https://nodejs.org/api/child_process.md#child_processexecfilesyncfile-args-options | Node.js, child_process.execFileSync}
 */
function gh(args: string[]): string {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

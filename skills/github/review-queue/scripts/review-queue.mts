#!/usr/bin/env node

// Prints the open pull requests of the repository as a Markdown table in the order to review them, the table the review-queue skill shows.

import { execFileSync } from 'node:child_process';

import {
  PULL_REQUESTS_QUERY,
  parsePullRequests,
  queueTable,
} from './order.mts';

// gh fills {owner} and {repo} from the repository of the current directory.
// https://cli.github.com/manual/gh_api
const pullRequests = parsePullRequests(
  gh([
    'api',
    'graphql',
    '-f',
    `query=${PULL_REQUESTS_QUERY}`,
    '-F',
    'owner={owner}',
    '-F',
    'name={repo}',
  ]),
);

if (pullRequests === null) {
  fail('GitHub gave no pull requests.');
}

console.log(
  pullRequests.length === 0
    ? 'No open pull requests.'
    : queueTable(pullRequests),
);

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

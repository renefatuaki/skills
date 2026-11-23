#!/usr/bin/env node

// Prints the open pull requests of the repository as a numbered list in the order to work them, each with its next action, the list the next-steps skill starts from.
// Outside a git repository it reads every repository one level below the current directory and names the repository in each line.

import { execFileSync } from 'node:child_process';

import { STEPS_QUERY, parseSteps, stepList } from './steps.mts';
import type { StepRow } from './steps.mts';
import { isInsideRepository, workspaceRepositories } from './workspace.mts';

const directory = process.cwd();

const rows = isInsideRepository(directory)
  ? openPullRequests(directory)
  : workspaceRows(directory);

console.log(rows.length === 0 ? 'No open pull requests.' : stepList(rows));

function workspaceRows(workspace: string): StepRow[] {
  const repositories = workspaceRepositories(workspace);

  if (repositories.length === 0) {
    fail('The current directory is no git repository and holds none.');
  }

  return repositories.flatMap(({ name, directory: checkout }) =>
    openPullRequests(checkout).map(row => ({ ...row, repository: name })),
  );
}

function openPullRequests(checkout: string): StepRow[] {
  // gh fills {owner} and {repo} from the repository of the directory it runs in.
  // https://cli.github.com/manual/gh_api
  const rows = parseSteps(
    gh(checkout, [
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
    fail(`GitHub gave no pull requests for ${checkout}.`);
  }

  return rows;
}

/**
 * Runs gh in a directory and returns its stdout, while its stderr goes straight to the terminal.
 * @see {@link https://nodejs.org/api/child_process.md#child_processexecfilesyncfile-args-options | Node.js, child_process.execFileSync}
 */
function gh(cwd: string, args: string[]): string {
  return execFileSync('gh', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

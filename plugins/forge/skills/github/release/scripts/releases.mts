#!/usr/bin/env node

// Prints as JSON the release of each repository in scope, with its open release pull request and the merged pull requests and issues dev ships to the default branch, and the repositories with nothing to release.

import { execFileSync } from 'node:child_process';

import {
  type Candidate,
  RELEASE_BRANCH,
  type ReleaseCandidate,
  scopeOf,
} from './scope.mts';
import {
  type MergedPullRequest,
  releaseIssues,
  type ShippedPullRequest,
  shippedPullRequests,
} from './shipped.mts';

type Release = {
  readonly path: string;
  readonly repository: string;
  readonly defaultBranch: string;
  /** The open pull request from dev to the default branch, null when the release opens one. */
  readonly pullRequest: {
    readonly number: number;
    readonly url: string;
  } | null;
  readonly shipped: readonly ShippedPullRequest[];
  readonly issues: readonly string[];
};

const releases: Release[] = [];
const skipped: { path: string; reason: string }[] = [];

for (const candidate of scopeOrExit()) {
  if (candidate.status === 'skip') {
    skipped.push({ path: candidate.path, reason: candidate.reason });
  } else {
    releases.push(releaseOf(candidate));
  }
}

console.log(JSON.stringify({ releases, skipped }, null, 2));

/** Reads the repositories the arguments name, and exits with the error when that fails, such as for a name that selects none. */
function scopeOrExit(): Candidate[] {
  try {
    return scopeOf(process.cwd(), process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

function releaseOf(candidate: ReleaseCandidate): Release {
  const { path, defaultBranch } = candidate;

  // 1. Name the repository once, so every later call names it with --repo.
  const repository = gh(path, [
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '--jq',
    '.nameWithOwner',
  ]).trim();

  // 2. Find the release pull request that is already open.
  const [pullRequest = null] = JSON.parse(
    gh(path, [
      'pr',
      'list',
      '--repo',
      repository,
      '--head',
      RELEASE_BRANCH,
      '--base',
      defaultBranch,
      '--state',
      'open',
      '--json',
      'number,url',
    ]),
  );

  // 3. Search the pull requests merged since dev last met the default branch, and keep those whose merge commit ships.
  // https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests.md#search-by-when-a-pull-request-was-merged
  const merged: MergedPullRequest[] = JSON.parse(
    gh(path, [
      'pr',
      'list',
      '--repo',
      repository,
      '--state',
      'merged',
      '--search',
      `merged:>=${candidate.since}`,
      '--limit',
      '1000',
      '--json',
      'number,title,url,body,mergeCommit',
    ]),
  );

  const shipped = shippedPullRequests(
    merged,
    new Set(candidate.commits),
    repository,
  );

  return {
    path,
    repository,
    defaultBranch,
    pullRequest,
    shipped,
    issues: releaseIssues(shipped),
  };
}

/**
 * Runs gh in `cwd` and returns its stdout, while its stderr goes straight to the terminal.
 * @see {@link https://nodejs.org/api/child_process.md#child_processexecfilesyncfile-args-options | Node.js, child_process.execFileSync}
 */
function gh(cwd: string, args: string[]): string {
  return execFileSync('gh', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

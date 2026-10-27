#!/usr/bin/env node

// Lists, for every file UPSTREAM.md copies from cursor/plugins, the commits on main since its base commit and their diff.
// Reads GitHub through `gh api` and writes only temporary files for the diff. An optional argument names another UPSTREAM.md to read.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY = 'cursor/plugins';
const BRANCH = 'main';
const TRACKED_FOLDERS = ['harness/pstack/claude-code/', 'cursor-team-kit/'];

/** A folder of cursor/plugins that UPSTREAM.md copies from, with the commit the copies are based on. */
type Source = {
  folder: string;
  base: string;
};

/** A row of the Files table, the upstream path and the path in this repository. */
type CopiedFile = {
  upstream: string;
  here: string;
};

/** A commit the commits API lists, the fields this script reads. */
type Commit = {
  sha: string;
  commit: { message: string };
};

type Outcome = 'changed' | 'unchanged' | 'untracked';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const upstreamPath = process.argv[2] ?? join(repo, 'UPSTREAM.md');
const commitDates = new Map<string, string>();

main();

function main(): void {
  if (!existsSync(upstreamPath)) {
    fail(`${upstreamPath} does not exist.`);
  }

  requireGitHubLogin();

  const markdown = readFileSync(upstreamPath, 'utf8');
  const sources = readSources(markdown);
  const counts: Record<Outcome, number> = {
    changed: 0,
    unchanged: 0,
    untracked: 0,
  };

  for (const file of readCopiedFiles(markdown)) {
    counts[checkFile(file, sources)]++;
  }

  console.log(
    `\nChecked against ${REPOSITORY}@${BRANCH}: ${counts.changed} changed, ${counts.unchanged} unchanged, ${counts.untracked} untracked skipped.`,
  );
}

/** Stops with a clear message when the GitHub CLI is missing or not logged in. */
function requireGitHubLogin(): void {
  const result = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });

  if (result.error !== undefined) {
    fail(
      'The GitHub CLI `gh` is not installed. Install it from https://cli.github.com.',
    );
  }

  if (result.status !== 0) {
    fail('The GitHub CLI `gh` is not logged in. Run `gh auth login`.');
  }
}

/** Prints what changed upstream for one copied file and returns its outcome. */
function checkFile(file: CopiedFile, sources: Source[]): Outcome {
  console.log(`\n== ${file.upstream} -> ${file.here}`);

  const source = sources.find(candidate =>
    file.upstream.startsWith(candidate.folder),
  );

  if (source === undefined) {
    console.log(`not in ${TRACKED_FOLDERS.join(' or ')}, skipped`);

    return 'untracked';
  }

  const baseBlob = blobSha(file.upstream, source.base);

  if (baseBlob === null) {
    fail(
      `${file.upstream} does not exist in ${REPOSITORY} at the base commit ${source.base}. Fix its row in ${upstreamPath}.`,
    );
  }

  const mainBlob = blobSha(file.upstream, BRANCH);

  if (mainBlob === baseBlob) {
    console.log('unchanged');

    return 'unchanged';
  }

  for (const commit of commitsSince(file.upstream, source.base)) {
    console.log(
      `${commit.sha.slice(0, 7)} ${commit.commit.message.split('\n')[0]}`,
    );
  }

  console.log(
    mainBlob === null
      ? `removed or renamed on ${BRANCH}`
      : diffBlobs(file.upstream, baseBlob, mainBlob),
  );

  return 'changed';
}

/**
 * Returns the blob SHA of the file at the ref, or null when the file does not exist there.
 * @see {@link https://docs.github.com/en/rest/repos/contents.md#get-repository-content | GitHub REST API, get repository content}
 */
function blobSha(path: string, ref: string): string | null {
  const sha = githubGet(
    `repos/${REPOSITORY}/contents/${encodePath(path)}?ref=${ref}`,
    '--jq',
    '.sha',
  );

  return sha === null ? null : sha.trim();
}

/**
 * Returns the commits on main that touched the path after the base commit, newest first.
 * @see {@link https://docs.github.com/en/rest/commits/commits.md#list-commits | GitHub REST API, list commits}
 */
function commitsSince(path: string, base: string): Commit[] {
  const commits: Commit[] = JSON.parse(
    githubGet(
      `repos/${REPOSITORY}/commits?sha=${BRANCH}&path=${encodeURIComponent(path)}&since=${commitDate(base)}&per_page=100`,
    ) ?? '[]',
  );

  return commits.filter(commit => commit.sha !== base);
}

/** Returns the committer date of the commit, fetched once per commit. */
function commitDate(sha: string): string {
  const cached = commitDates.get(sha);

  if (cached !== undefined) {
    return cached;
  }

  const date = githubGet(
    `repos/${REPOSITORY}/commits/${sha}`,
    '--jq',
    '.commit.committer.date',
  );

  if (date === null) {
    fail(`The base commit ${sha} does not exist in ${REPOSITORY}.`);
  }

  commitDates.set(sha, date.trim());

  return date.trim();
}

/** Returns the unified diff of the two blobs of the path, computed on this machine. */
function diffBlobs(path: string, baseBlob: string, mainBlob: string): string {
  const folder = mkdtempSync(join(tmpdir(), 'check-upstream-'));
  const before = join(folder, 'base');
  const after = join(folder, 'main');

  try {
    writeFileSync(before, rawBlob(baseBlob));
    writeFileSync(after, rawBlob(mainBlob));

    return spawnSync(
      'diff',
      ['-u', '--label', `a/${path}`, '--label', `b/${path}`, before, after],
      { encoding: 'utf8' },
    ).stdout;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * Returns the content of the blob as text.
 * @see {@link https://docs.github.com/en/rest/git/blobs.md#get-a-blob | GitHub REST API, get a blob}
 */
function rawBlob(sha: string): string {
  return (
    githubGet(
      `repos/${REPOSITORY}/git/blobs/${sha}`,
      '--header',
      'Accept: application/vnd.github.raw+json',
    ) ?? fail(`The blob ${sha} does not exist in ${REPOSITORY}.`)
  );
}

/** Runs `gh api` as a GET and returns its output, or null when GitHub answers 404. */
function githubGet(endpoint: string, ...options: string[]): string | null {
  const result = spawnSync(
    'gh',
    ['api', '--method', 'GET', endpoint, ...options],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  if (result.status === 0) {
    return result.stdout;
  }

  if (result.stderr.includes('HTTP 404')) {
    return null;
  }

  fail(`gh api ${endpoint} failed. ${result.stderr.trim()}`);
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Reads the rows of the Sources table that name a tracked folder of cursor/plugins. */
function readSources(markdown: string): Source[] {
  return tableRows(markdown, 'Sources')
    .filter(
      ([source, folder]) =>
        source.includes(`github.com/${REPOSITORY}/`) &&
        TRACKED_FOLDERS.includes(folder),
    )
    .map(([, folder, , base]) => ({ folder, base }));
}

function readCopiedFiles(markdown: string): CopiedFile[] {
  return tableRows(markdown, 'Files').map(([upstream, here]) => ({
    upstream,
    here,
  }));
}

/** Returns the cells of every body row of the first table under the heading, backticks removed. */
function tableRows(markdown: string, heading: string): string[][] {
  const lines = markdown.split('\n');
  const start = lines.indexOf(`## ${heading}`);

  if (start === -1) {
    fail(`${upstreamPath} has no "## ${heading}" section.`);
  }

  const section = lines.slice(start + 1);
  const end = section.findIndex(line => line.startsWith('## '));
  const tableLines = section
    .slice(0, end === -1 ? undefined : end)
    .filter(line => line.startsWith('|'));

  const bodyLines = tableLines.slice(1).filter(line => !isDelimiterRow(line));

  return bodyLines.map(cellsOf);
}

function isDelimiterRow(line: string): boolean {
  return /^\|(\s*:?-+:?\s*\|)+$/.test(line.trim());
}

function cellsOf(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(cell => cell.replaceAll('`', '').trim());
}

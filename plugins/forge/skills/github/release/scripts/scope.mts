// Finds the repositories a release looks at, the current one or every checkout one level below a folder that is none, and the commits their dev holds beyond the default branch.

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/** A repository whose dev holds commits the default branch lacks. */
export type ReleaseCandidate = {
  readonly status: 'release';
  readonly path: string;
  readonly defaultBranch: string;
  /** The full SHAs of the commits of `origin/dev` that the default branch lacks. */
  readonly commits: readonly string[];
  /** The committer date of the commit dev last shared with the default branch, so every pull request that ships was merged after it. */
  readonly since: string;
};

/** A repository in scope with nothing to release. */
export type SkippedCandidate = {
  readonly status: 'skip';
  readonly path: string;
  readonly reason: string;
};

export type Candidate = ReleaseCandidate | SkippedCandidate;

export const RELEASE_BRANCH = 'dev';

/** Reads the repositories of `directory` that `names` select, all of them when `names` is empty, and throws for a name that selects none. */
export function scopeOf(
  directory: string,
  names: readonly string[],
): Candidate[] {
  const folders = selectFolders(repositoryFolders(directory), names);

  return folders.map(candidateOf);
}

/** Returns the top folder of the repository that holds `directory`, or every main checkout one level below it, since a linked worktree holds a `.git` file in place of a folder. */
function repositoryFolders(directory: string): string[] {
  const topLevel = repositoryRoot(directory);

  if (topLevel !== null) {
    return [topLevel];
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(directory, entry.name))
    .filter(folder => isDirectory(join(folder, '.git')))
    .sort();
}

/** Keeps the folders whose name equals a name or ends with `-<name>`, so `api` selects `grocery-lens-api`. */
function selectFolders(
  folders: readonly string[],
  names: readonly string[],
): string[] {
  if (names.length === 0) {
    return [...folders];
  }

  return names.flatMap(name => {
    const selected = folders.filter(
      folder =>
        basename(folder) === name || basename(folder).endsWith(`-${name}`),
    );

    if (selected.length === 0) {
      throw new Error(`No repository named "${name}" in scope.`);
    }

    return selected;
  });
}

function candidateOf(path: string): Candidate {
  // 1. Ask the remote for its default branch and whether it has dev, since a local origin/HEAD can be stale.
  // https://git-scm.com/docs/git-ls-remote#Documentation/git-ls-remote.txt---symref
  const heads = git(path, [
    'ls-remote',
    '--symref',
    'origin',
    'HEAD',
    `refs/heads/${RELEASE_BRANCH}`,
  ]);

  const defaultBranch = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(heads)?.[1];

  if (defaultBranch === undefined) {
    throw new Error(`The origin of ${path} names no default branch.`);
  }

  if (!heads.includes(`\trefs/heads/${RELEASE_BRANCH}\n`)) {
    return {
      status: 'skip',
      path,
      reason: `no ${RELEASE_BRANCH} branch on origin`,
    };
  }

  // 2. Fetch both branches, which also moves their remote-tracking branches.
  git(path, ['fetch', '--quiet', 'origin', defaultBranch, RELEASE_BRANCH]);

  // 3. Read the commits dev holds beyond the default branch.
  const base = `origin/${defaultBranch}`;
  const head = `origin/${RELEASE_BRANCH}`;
  const commits = git(path, ['rev-list', `${base}..${head}`])
    .split('\n')
    .filter(Boolean);

  if (commits.length === 0) {
    return {
      status: 'skip',
      path,
      reason: `${RELEASE_BRANCH} holds no commit beyond ${defaultBranch}`,
    };
  }

  // 4. Date the commit dev last shared with the default branch.
  const mergeBase = git(path, ['merge-base', base, head]).trim();
  const since = git(path, ['show', '--no-patch', '--format=%cI', mergeBase]);

  return {
    status: 'release',
    path,
    defaultBranch,
    commits,
    since: since.trim(),
  };
}

/** Returns the top folder of the repository that holds `directory`, null outside one, without the error git prints there. */
function repositoryRoot(directory: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/**
 * Runs git in `cwd` and returns its stdout, while its stderr goes straight to the terminal.
 * @see {@link https://nodejs.org/api/child_process.md#child_processexecfilesyncfile-args-options | Node.js, child_process.execFileSync}
 */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

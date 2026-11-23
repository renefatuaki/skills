// Finds the git repositories one level below a directory that is no repository itself, one per repository even when ticket worktrees of it sit beside it.

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** A git repository of a workspace, named after its main checkout. */
export type WorkspaceRepository = {
  readonly name: string;
  /** The main checkout, a directory to run commands in. */
  readonly directory: string;
};

export function isInsideRepository(directory: string): boolean {
  return git(directory, ['rev-parse', '--is-inside-work-tree']) === 'true';
}

/**
 * Lists the repositories in the subdirectories of a directory, sorted by name.
 * @see {@link https://git-scm.com/docs/git-rev-parse#Documentation/git-rev-parse.txt---git-common-dir | git rev-parse, --git-common-dir}
 */
export function workspaceRepositories(
  directory: string,
): WorkspaceRepository[] {
  const repositories = new Map<string, WorkspaceRepository>();

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const commonDirectory = entry.isDirectory()
      ? git(join(directory, entry.name), [
          'rev-parse',
          '--path-format=absolute',
          '--git-common-dir',
        ])
      : null;

    if (commonDirectory === null || repositories.has(commonDirectory)) {
      continue;
    }

    const mainCheckout = dirname(commonDirectory);

    repositories.set(commonDirectory, {
      name: basename(mainCheckout),
      directory: mainCheckout,
    });
  }

  return [...repositories.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/** Runs git in a directory and returns its trimmed stdout, null when git fails there. */
function git(directory: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', directory, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

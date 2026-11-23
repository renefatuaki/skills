#!/usr/bin/env node

// Runs the cleanup-merged script in workspaces of real git repositories, each with a bare origin, against a stand-in gh that serves their merged pull requests, and compares the report and what stays in each repository and on its origin with the expected ones.

import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(
  root,
  'plugins',
  'forge',
  'skills',
  'github',
  'cleanup-merged',
  'scripts',
  'cleanup-merged.mts',
);

const fakeGh = join(root, 'tests', 'fixtures', 'cleanup-merged', 'bin');

/** Holds every case, and an empty global git config so the user's own config never reaches git. */
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'cleanup-merged-')));
const gitConfig = join(scratch, 'gitconfig');

writeFileSync(gitConfig, '');

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: gitConfig,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

/** A pull request as `gh pr list --json` prints it. */
type PullRequestNode = {
  number: number;
  url: string;
  headRefName: string;
  headRefOid: string;
  body: string;
};

/** A repository of a case, with the state the stand-in gh serves for it. */
type Repository = {
  nameWithOwner: string;
  /** The main checkout in the workspace. */
  path: string;
  /** The bare repository that plays GitHub. */
  origin: string;
  /** A clone of origin on dev, which merges the pull requests the way GitHub does. */
  github: string;
  defaultBranch: string;
  merged: PullRequestNode[];
  /** The open pull requests, by their base as `gh pr list --json baseRefName` prints them. */
  open: { baseRefName: string }[];
  openIssues: number[];
};

/** What stays of a repository after the run. */
type Snapshot = {
  worktrees: string[];
  branches: string[];
  originBranches: string[];
  /** Whether the local dev is at the dev of origin. */
  isDevCurrent: boolean;
};

/** The folder the script runs in, the report it should print and what should stay of each repository. */
type Expectation = {
  cwd: string;
  report: unknown;
  snapshots: Map<Repository, Snapshot>;
};

/** Folders a case made read-only, which need write access back before the scratch folder can go. */
const readOnly: string[] = [];

const CASES: {
  name: string;
  build: (caseFolder: string) => Expectation;
}[] = [
  {
    name: 'a merged pull request loses its worktree and its branches, and its open issue waits with the criteria its test plan proved',
    build: caseFolder => {
      const app = createRepository(caseFolder, 'app');
      const ticket = join(caseFolder, 'workspace', 'app-10');
      const agent = join(app.path, '.claude', 'worktrees', 'agent-a1');

      mergeTicket(app, {
        number: 11,
        branch: 'feat/10-scan',
        worktree: ticket,
        body: [
          '## Linked issue',
          '',
          'Closes #10',
          '',
          '<!-- Closes #99 when this pull request finishes the issue. -->',
          '',
          '### Steps',
          '',
          '- [x] 1. Scan a receipt. The total shows. (criterion 2)',
          '- [x] 2. Scan a long receipt. The total shows. (criterion 2)',
          '- [x] 3. Scan in daylight. The flash stays off. (criterion 3)',
          '- [ ] 4. Scan in the dark. The flash turns on. (criterion 3) (needs a person: a physical iPhone)',
        ].join('\n'),
      });

      writeFileSync(join(ticket, 'notes.txt'), 'scratch');
      mkdirSync(join(ticket, 'build'));
      writeFileSync(join(ticket, 'build', 'app'), 'binary');

      mergeTicket(app, {
        number: 12,
        branch: 'fix/12-crash',
        worktree: agent,
        body: '## Linked issue\n\nRefs #12',
      });

      app.merged.push(
        pullRequest(app, {
          number: 9,
          branch: 'feat/9-gone',
          head: 'a'.repeat(40),
          body: 'Closes #9',
        }),
      );

      app.openIssues.push(10, 12, 99);

      const before = git(app.path, 'rev-parse', 'dev');

      return {
        cwd: app.path,
        report: report({
          path: app.path,
          pullRequests: [
            {
              ...removedEverywhere(app, 11, 'feat/10-scan', ticket),
              closes: [{ url: issueUrl(app, 10), proven: [2], unproven: [3] }],
            },
            {
              ...removedEverywhere(app, 12, 'fix/12-crash', agent),
              refers: [issueUrl(app, 12)],
            },
          ],
          fastForward: fastForwarded(app, before),
        }),
        snapshots: new Map([[app, clean(app)]]),
      };
    },
  },
  {
    name: 'a worktree with uncommitted changes to tracked files stays with its branch, while the branch on GitHub goes',
    build: caseFolder => {
      const app = createRepository(caseFolder, 'app');
      const ticket = join(caseFolder, 'workspace', 'app-10');

      mergeTicket(app, {
        number: 11,
        branch: 'feat/10-scan',
        worktree: ticket,
        body: 'Closes #10',
      });

      writeFileSync(join(ticket, 'README.md'), 'changed');

      const before = git(app.path, 'rev-parse', 'dev');

      return {
        cwd: app.path,
        report: report({
          path: app.path,
          pullRequests: [
            {
              ...pullRequestReport(app, 11, 'feat/10-scan'),
              removed: [{ kind: 'remote branch', name: 'feat/10-scan' }],
              kept: [
                {
                  kind: 'worktree',
                  name: ticket,
                  keptBecause: 'has uncommitted changes to tracked files',
                },
                {
                  kind: 'branch',
                  name: 'feat/10-scan',
                  keptBecause: 'its worktree stays',
                },
              ],
            },
          ],
          fastForward: fastForwarded(app, before),
        }),
        snapshots: new Map([
          [
            app,
            {
              ...clean(app),
              worktrees: [app.path, ticket],
              branches: ['dev', 'feat/10-scan', 'main'],
            },
          ],
        ]),
      };
    },
  },
  {
    name: 'a branch with a commit the pull request does not hold stays with its worktree',
    build: caseFolder => {
      const app = createRepository(caseFolder, 'app');
      const ticket = join(caseFolder, 'workspace', 'app-10');

      mergeTicket(app, {
        number: 11,
        branch: 'feat/10-scan',
        worktree: ticket,
        body: 'Closes #10',
      });

      commitFile(ticket, 'follow-up.txt');

      const before = git(app.path, 'rev-parse', 'dev');
      const reason = 'has commits that the pull request does not hold';

      return {
        cwd: app.path,
        report: report({
          path: app.path,
          pullRequests: [
            {
              ...pullRequestReport(app, 11, 'feat/10-scan'),
              removed: [{ kind: 'remote branch', name: 'feat/10-scan' }],
              kept: [
                {
                  kind: 'worktree',
                  name: ticket,
                  keptBecause: `its branch ${reason}`,
                },
                { kind: 'branch', name: 'feat/10-scan', keptBecause: reason },
              ],
            },
          ],
          fastForward: fastForwarded(app, before),
        }),
        snapshots: new Map([
          [
            app,
            {
              ...clean(app),
              worktrees: [app.path, ticket],
              branches: ['dev', 'feat/10-scan', 'main'],
            },
          ],
        ]),
      };
    },
  },
  {
    name: 'a worktree that holds the current directory stays with its branch',
    build: caseFolder => {
      const app = createRepository(caseFolder, 'app');
      const ticket = join(caseFolder, 'workspace', 'app-10');

      mergeTicket(app, {
        number: 11,
        branch: 'feat/10-scan',
        worktree: ticket,
        body: 'Closes #10',
      });

      const before = git(app.path, 'rev-parse', 'dev');

      return {
        cwd: ticket,
        report: report({
          path: app.path,
          pullRequests: [
            {
              ...pullRequestReport(app, 11, 'feat/10-scan'),
              removed: [{ kind: 'remote branch', name: 'feat/10-scan' }],
              kept: [
                {
                  kind: 'worktree',
                  name: ticket,
                  keptBecause: 'holds the current directory',
                },
                {
                  kind: 'branch',
                  name: 'feat/10-scan',
                  keptBecause: 'its worktree stays',
                },
              ],
            },
          ],
          fastForward: fastForwarded(app, before),
        }),
        snapshots: new Map([
          [
            app,
            {
              ...clean(app),
              worktrees: [app.path, ticket],
              branches: ['dev', 'feat/10-scan', 'main'],
            },
          ],
        ]),
      };
    },
  },
  {
    name: 'a merged layer that an open pull request builds on keeps its branches',
    build: caseFolder => {
      const app = createRepository(caseFolder, 'app');
      const layer = 'stack/feat/10-scan/1';

      git(app.path, 'branch', layer, 'dev');
      git(app.path, 'switch', '-q', layer);

      const head = commitFile(app.path, 'layer.txt');

      git(
        app.path,
        'push',
        '-q',
        'origin',
        layer,
        `${layer}:refs/pull/11/head`,
      );

      git(app.path, 'switch', '-q', 'dev');
      squashMerge(app, layer);
      app.merged.push(
        pullRequest(app, { number: 11, branch: layer, head, body: 'Refs #10' }),
      );

      app.open.push({ baseRefName: layer });
      app.openIssues.push(10);

      const before = git(app.path, 'rev-parse', 'dev');

      return {
        cwd: app.path,
        report: report({
          path: app.path,
          pullRequests: [],
          fastForward: fastForwarded(app, before),
        }),
        snapshots: new Map([
          [
            app,
            {
              ...clean(app),
              branches: ['dev', 'main', layer],
              originBranches: ['dev', 'main', layer],
            },
          ],
        ]),
      };
    },
  },
  {
    name: 'a branch that GitHub rebased in a stack counts as merged',
    build: caseFolder => {
      const app = createRepository(caseFolder, 'app');
      const ticket = join(caseFolder, 'workspace', 'app-10');
      const branch = 'feat/10-scan';

      git(app.path, 'worktree', 'add', '-q', '-b', branch, ticket, 'dev');
      commitFile(ticket, 'scan.txt');
      git(ticket, 'push', '-q', 'origin', branch);

      commitFile(app.github, 'other.txt');
      git(app.github, 'push', '-q', 'origin', 'HEAD:dev');
      git(app.github, 'fetch', '-q', 'origin');
      git(app.github, 'switch', '-q', '--detach', 'origin/dev');
      git(app.github, 'cherry-pick', `origin/${branch}`);

      const head = git(app.github, 'rev-parse', 'HEAD');

      git(
        app.github,
        'push',
        '-q',
        '--force',
        'origin',
        `HEAD:refs/heads/${branch}`,
        `HEAD:refs/pull/11/head`,
      );

      git(app.github, 'switch', '-q', 'dev');
      squashMerge(app, branch);
      app.merged.push(
        pullRequest(app, { number: 11, branch, head, body: 'Closes #10' }),
      );

      const before = git(app.path, 'rev-parse', 'dev');

      return {
        cwd: app.path,
        report: report({
          path: app.path,
          pullRequests: [removedEverywhere(app, 11, branch, ticket)],
          fastForward: fastForwarded(app, before),
        }),
        snapshots: new Map([[app, clean(app)]]),
      };
    },
  },
  {
    name: 'a folder that outlives its worktree on files git cannot delete stays for the user',
    build: caseFolder => {
      const app = createRepository(caseFolder, 'app');
      const ticket = join(caseFolder, 'workspace', 'app-10');
      const locked = join(ticket, 'build', 'locked');

      mergeTicket(app, {
        number: 11,
        branch: 'feat/10-scan',
        worktree: ticket,
        body: 'Closes #10',
      });

      mkdirSync(locked, { recursive: true });
      writeFileSync(join(locked, 'cache'), 'cache');
      chmodSync(locked, 0o555);
      readOnly.push(locked);

      const before = git(app.path, 'rev-parse', 'dev');

      return {
        cwd: app.path,
        report: report({
          path: app.path,
          pullRequests: [
            {
              ...removedEverywhere(app, 11, 'feat/10-scan', ticket),
              kept: [
                {
                  kind: 'directory',
                  name: ticket,
                  keptBecause: `error: failed to delete '${ticket}': Permission denied`,
                },
              ],
            },
          ],
          fastForward: fastForwarded(app, before),
        }),
        snapshots: new Map([[app, clean(app)]]),
      };
    },
  },
  {
    name: 'in a workspace each repository one level below the folder is cleaned once, and a release keeps dev',
    build: caseFolder => {
      const workspace = join(caseFolder, 'workspace');
      const app = createRepository(caseFolder, 'app');
      const lib = createRepository(caseFolder, 'lib');
      const ticket = join(workspace, 'app-10');

      mergeTicket(app, {
        number: 11,
        branch: 'feat/10-scan',
        worktree: ticket,
        body: 'Closes #10',
      });

      git(lib.github, 'fetch', '-q', 'origin');
      git(lib.github, 'push', '-q', 'origin', 'origin/dev:refs/heads/main');
      lib.merged.push(
        pullRequest(lib, {
          number: 5,
          branch: 'dev',
          head: git(lib.path, 'rev-parse', 'dev'),
          body: '## Summary\n\nRelease.',
        }),
      );

      mkdirSync(join(workspace, 'notes'));

      const before = git(app.path, 'rev-parse', 'dev');

      return {
        cwd: workspace,
        report: report(
          {
            path: app.path,
            pullRequests: [removedEverywhere(app, 11, 'feat/10-scan', ticket)],
            fastForward: fastForwarded(app, before),
          },
          {
            path: lib.path,
            pullRequests: [],
            fastForward: 'dev is up to date with origin.',
          },
        ),
        snapshots: new Map([
          [app, clean(app)],
          [lib, clean(lib)],
        ]),
      };
    },
  },
];

let failures = 0;

try {
  for (const [index, { name, build }] of CASES.entries()) {
    const caseFolder = join(scratch, String(index));
    const expected = build(caseFolder);
    const repositories = [...expected.snapshots.keys()];
    const report = run(expected.cwd, repositories, caseFolder);
    const snapshots = repositories.map(snapshot);
    const passed =
      isDeepStrictEqual(report, expected.report) &&
      isDeepStrictEqual(snapshots, [...expected.snapshots.values()]);

    if (!passed) {
      failures++;
    }

    console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);

    if (!passed) {
      console.log(
        `  expected ${JSON.stringify({ report: expected.report, snapshots: [...expected.snapshots.values()] })}\n  actual   ${JSON.stringify({ report, snapshots })}`,
      );
    }
  }
} finally {
  for (const folder of readOnly) {
    chmodSync(folder, 0o755);
  }

  rmSync(scratch, { recursive: true, force: true });
}

console.log(failures === 0 ? 'All cases pass.' : `${failures} case(s) failed.`);

process.exit(failures === 0 ? 0 : 1);

/** Starts the script in the folder with the stand-in gh first on the PATH, serving the repositories, and reads its report. */
function run(
  cwd: string,
  repositories: readonly Repository[],
  caseFolder: string,
): unknown {
  const state = join(caseFolder, 'gh.json');

  writeFileSync(
    state,
    JSON.stringify(
      Object.fromEntries(
        repositories.map(repository => [repository.nameWithOwner, repository]),
      ),
    ),
  );

  const result = spawnSync(process.execPath, [script], {
    cwd,
    encoding: 'utf8',
    env: {
      ...GIT_ENV,
      PATH: `${fakeGh}:${process.env.PATH}`,
      FAKE_GH_STATE: state,
    },
  });

  if (result.status !== 0) {
    return { status: result.status, stderr: result.stderr };
  }

  return JSON.parse(result.stdout);
}

/** Creates a repository with main and dev in the workspace of the case, its bare origin and the clone that merges on its behalf. */
function createRepository(caseFolder: string, name: string): Repository {
  const path = join(caseFolder, 'workspace', name);
  const origin = join(caseFolder, 'origins', `${name}.git`);
  const github = join(caseFolder, 'github', name);

  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q', '-b', 'main');
  writeFileSync(join(path, '.gitignore'), 'build/\n.claude/\n');
  commitFile(path, 'README.md');
  git(path, 'clone', '-q', '--bare', path, origin);
  git(path, 'remote', 'add', 'origin', origin);
  git(path, 'switch', '-q', '-c', 'dev');
  git(path, 'push', '-q', '-u', 'origin', 'dev');
  git(path, 'clone', '-q', '--branch', 'dev', origin, github);

  return {
    nameWithOwner: `acme/${name}`,
    path,
    origin,
    github,
    defaultBranch: 'main',
    merged: [],
    open: [],
    openIssues: [],
  };
}

/** Opens the branch from dev in the worktree, commits on it, pushes it with its pull request ref and squash-merges it into dev on origin. */
function mergeTicket(
  repository: Repository,
  ticket: { number: number; branch: string; worktree: string; body: string },
): void {
  git(
    repository.path,
    'worktree',
    'add',
    '-q',
    '-b',
    ticket.branch,
    ticket.worktree,
    'dev',
  );

  const head = commitFile(ticket.worktree, `${ticket.number}.txt`);

  git(
    ticket.worktree,
    'push',
    '-q',
    'origin',
    ticket.branch,
    `${ticket.branch}:refs/pull/${ticket.number}/head`,
  );

  squashMerge(repository, ticket.branch);
  repository.merged.push(pullRequest(repository, { ...ticket, head }));
}

function squashMerge(repository: Repository, branch: string): void {
  git(repository.github, 'fetch', '-q', 'origin');
  git(repository.github, 'reset', '-q', '--hard', 'origin/dev');
  git(repository.github, 'merge', '-q', '--squash', `origin/${branch}`);
  git(repository.github, 'commit', '-q', '-m', `Merge ${branch}`);
  git(repository.github, 'push', '-q', 'origin', 'HEAD:dev');
}

/** Writes the file and commits everything in the worktree, returning the new commit. */
function commitFile(worktree: string, file: string): string {
  writeFileSync(join(worktree, file), file);
  git(worktree, 'add', '--all');
  git(worktree, 'commit', '-q', '-m', `Add ${file}`);

  return git(worktree, 'rev-parse', 'HEAD');
}

function pullRequest(
  repository: Repository,
  {
    number,
    branch,
    head,
    body,
  }: { number: number; branch: string; head: string; body: string },
): PullRequestNode {
  return {
    number,
    url: `https://github.com/${repository.nameWithOwner}/pull/${number}`,
    headRefName: branch,
    headRefOid: head,
    body,
  };
}

function report(...repositories: unknown[]): unknown {
  return { repositories };
}

function pullRequestReport(
  repository: Repository,
  number: number,
  branch: string,
): object {
  return {
    number,
    url: `https://github.com/${repository.nameWithOwner}/pull/${number}`,
    branch,
    removed: [],
    kept: [],
    closes: [],
    refers: [],
  };
}

/** The report of a pull request whose worktree, local branch and remote branch the run removed. */
function removedEverywhere(
  repository: Repository,
  number: number,
  branch: string,
  worktree: string,
): object {
  return {
    ...pullRequestReport(repository, number, branch),
    removed: [
      { kind: 'worktree', name: worktree },
      { kind: 'branch', name: branch },
      { kind: 'remote branch', name: branch },
    ],
  };
}

function issueUrl(repository: Repository, number: number): string {
  return `https://github.com/${repository.nameWithOwner}/issues/${number}`;
}

/** The line the run reports once it moved the local dev from the commit to the dev of origin. */
function fastForwarded(repository: Repository, before: string): string {
  const after = git(repository.origin, 'rev-parse', 'dev');

  return `dev is fast-forwarded from ${before.slice(0, 7)} to ${after.slice(0, 7)}.`;
}

/** A repository left with its main checkout alone, main and dev on both sides and dev at origin. */
function clean(repository: Repository): Snapshot {
  return {
    worktrees: [repository.path],
    branches: ['dev', 'main'],
    originBranches: ['dev', 'main'],
    isDevCurrent: true,
  };
}

function snapshot(repository: Repository): Snapshot {
  const worktrees = git(repository.path, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length));

  return {
    worktrees,
    branches: refNames(repository.path, 'refs/heads/'),
    originBranches: refNames(repository.origin, 'refs/heads/'),
    isDevCurrent:
      git(repository.path, 'rev-parse', 'dev') ===
      git(repository.origin, 'rev-parse', 'dev'),
  };
}

function refNames(gitFolder: string, prefix: string): string[] {
  return git(gitFolder, 'for-each-ref', '--format=%(refname)', prefix)
    .split('\n')
    .filter(line => line !== '')
    .map(ref => ref.slice(prefix.length));
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: GIT_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

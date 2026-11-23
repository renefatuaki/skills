#!/usr/bin/env node

// Runs the release script in a workspace of real git checkouts against a stand-in gh, compares the releases it prints with the expected ones, and reads the issues of real pull request descriptions.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closedIssues } from '../plugins/forge/skills/github/release/scripts/shipped.mts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(
  root,
  'plugins',
  'forge',
  'skills',
  'github',
  'release',
  'scripts',
  'releases.mts',
);

const fakeGh = join(root, 'tests', 'fixtures', 'release', 'bin');

const BASE_DATE = '2026-11-10T09:00:00+01:00';

const BODY = `## Linked issue

Closes #4

## Test plan

### Steps

- [x] 1. Open the app. The home screen shows.
- [ ] 2. Scan a receipt. The items show. (needs a person: a printed receipt)`;

const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'forge-release-')));
const origins = mkdtempSync(join(tmpdir(), 'forge-release-origins-'));

const api = checkout('gl-api', { devCommits: 2 });

checkout('gl-db', { devCommits: 0 });
checkout('gl-design', { devCommits: null });
git(api.path, ['worktree', 'add', '--quiet', '-b', 'feat/7', '../gl-api-7']);
mkdirSync(join(workspace, 'notes'));

const fakeData = {
  folders: { 'gl-api': 'acme/gl-api' },
  pullRequests: {
    'acme/gl-api': {
      open: [{ number: 7, url: 'https://github.com/acme/gl-api/pull/7' }],
      merged: [
        merged({
          number: 1,
          title: 'chore: release the scanner',
          mergeCommit: api.base,
          mergedAt: BASE_DATE,
        }),
        merged({
          number: 2,
          title: 'feat: scan a receipt',
          mergeCommit: api.dev[0],
          mergedAt: '2026-11-11T09:00:00Z',
          body: BODY,
        }),
        merged({
          number: 3,
          title: 'fix: keep the total',
          mergeCommit: api.dev[1],
          mergedAt: '2026-11-12T09:00:00Z',
          body: 'Fixes acme/gl-ios#9',
        }),
      ],
    },
  },
};

const API_RELEASE = {
  path: api.path,
  repository: 'acme/gl-api',
  defaultBranch: 'main',
  pullRequest: { number: 7, url: 'https://github.com/acme/gl-api/pull/7' },
  shipped: [
    {
      number: 2,
      title: 'feat: scan a receipt',
      url: 'https://github.com/acme/gl-api/pull/2',
      issues: ['#4'],
      openSteps: [2],
    },
    {
      number: 3,
      title: 'fix: keep the total',
      url: 'https://github.com/acme/gl-api/pull/3',
      issues: ['acme/gl-ios#9'],
      openSteps: [],
    },
  ],
  issues: ['#4', 'acme/gl-ios#9'],
};

const DB_SKIP = {
  path: join(workspace, 'gl-db'),
  reason: 'dev holds no commit beyond main',
};

const DESIGN_SKIP = {
  path: join(workspace, 'gl-design'),
  reason: 'no dev branch on origin',
};

const RUN_CASES: {
  name: string;
  cwd: string;
  args: string[];
  expected: unknown;
}[] = [
  {
    name: 'a workspace releases each checkout whose dev is ahead and skips the others, past its worktrees and plain folders',
    cwd: workspace,
    args: [],
    expected: { releases: [API_RELEASE], skipped: [DB_SKIP, DESIGN_SKIP] },
  },
  {
    name: 'a name selects the checkout whose folder ends with it',
    cwd: workspace,
    args: ['api'],
    expected: { releases: [API_RELEASE], skipped: [] },
  },
  {
    name: 'inside a repository only that repository is in scope',
    cwd: join(workspace, 'gl-db'),
    args: [],
    expected: { releases: [], skipped: [DB_SKIP] },
  },
  {
    name: 'a name that selects no repository fails with that name',
    cwd: workspace,
    args: ['web'],
    expected: 'No repository named "web" in scope.',
  },
];

const ISSUE_CASES: { name: string; body: string; expected: string[] }[] = [
  {
    name: 'each closing keyword closes its own issue, in any letter case',
    body: 'Closes #9. Closes #10, closes #11, Resolves: #12.',
    expected: ['#9', '#10', '#11', '#12'],
  },
  {
    name: 'an issue of another repository keeps its repository, one of this repository loses it',
    body: 'Fixes renefatuaki/grocery-lens-ios#302\nCloses acme/gl-api#5',
    expected: ['renefatuaki/grocery-lens-ios#302', '#5'],
  },
  {
    name: 'a reference without a closing keyword and the example in a template comment close nothing',
    body: '<!-- Closes #123 when this pull request finishes the issue, Refs #123 otherwise. -->\n\nRefs #39',
    expected: [],
  },
];

let failures = 0;

for (const { name, cwd, args, expected } of RUN_CASES) {
  failures += report(name, run(cwd, args), expected);
}

for (const { name, body, expected } of ISSUE_CASES) {
  failures += report(name, closedIssues(body, 'acme/gl-api'), expected);
}

rmSync(workspace, { recursive: true });
rmSync(origins, { recursive: true });

console.log(failures === 0 ? 'All cases pass.' : `${failures} case(s) failed.`);

process.exit(failures === 0 ? 0 : 1);

/** Runs the release script as the skill does and returns its parsed output, or its error when it fails. */
function run(cwd: string, args: string[]): unknown {
  const result = spawnSync('node', [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeGh}:${process.env.PATH}`,
      FAKE_GH_DATA: JSON.stringify(fakeData),
    },
  });

  return result.status === 0 ? JSON.parse(result.stdout) : result.stderr.trim();
}

/** Clones a fresh origin into the workspace with one commit on main and, unless `devCommits` is null, a dev branch that many commits ahead, each pushed. */
function checkout(
  name: string,
  { devCommits }: { devCommits: number | null },
): { path: string; base: string; dev: string[] } {
  const origin = join(origins, `${name}.git`);
  const path = join(workspace, name);

  git(origins, ['init', '--quiet', '--bare', '--initial-branch=main', origin]);
  git(workspace, ['clone', '--quiet', origin, path]);

  const base = commit(path, BASE_DATE);

  git(path, ['push', '--quiet', 'origin', 'main']);

  if (devCommits === null) {
    return { path, base, dev: [] };
  }

  git(path, ['switch', '--quiet', '--create', 'dev']);

  const dev = Array.from({ length: devCommits }, (_, index) =>
    commit(path, `2026-11-1${index + 1}T09:00:00Z`),
  );

  git(path, ['push', '--quiet', 'origin', 'dev']);

  return { path, base, dev };
}

/** Commits nothing at the given committer date and returns the new commit's SHA. */
function commit(path: string, date: string): string {
  git(
    path,
    ['commit', '--quiet', '--allow-empty', '--message', `chore: ${date}`],
    {
      GIT_COMMITTER_DATE: date,
    },
  );

  return git(path, ['rev-parse', 'HEAD']).trim();
}

/** Builds a merged pull request of acme/gl-api as the stand-in gh serves it, with an empty description unless one is given. */
function merged({
  number,
  title,
  mergeCommit,
  mergedAt,
  body = '',
}: {
  number: number;
  title: string;
  mergeCommit: string;
  mergedAt: string;
  body?: string;
}): Record<string, unknown> {
  return {
    number,
    title,
    url: `https://github.com/acme/gl-api/pull/${number}`,
    body,
    mergeCommit: { oid: mergeCommit },
    mergedAt,
  };
}

/** Runs git without the user's hooks, signing or identity, so the fixture builds the same on every machine. */
function git(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      ...args,
    ],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

function report(name: string, actual: unknown, expected: unknown): number {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);

  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  if (!ok) {
    console.log(
      `  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`,
    );
  }

  return ok ? 0 : 1;
}

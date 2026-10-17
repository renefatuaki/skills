#!/usr/bin/env node

// Runs the ticket-base script against a stand-in gh that serves one board per case and compares the base it prints with the expected one.

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(
  root,
  'skills',
  'workflow',
  'engineering',
  'scripts',
  'ticket-base.mts',
);

const fakeGh = join(root, 'tests', 'fixtures', 'ticket-base', 'bin');

const REPOSITORY = 'acme/app';
const PROJECT = 'PVT_1';
const TICKET = issueUrl(10);

type State = 'OPEN' | 'CLOSED' | 'MERGED';

type PullRequest = {
  number: number;
  state: State;
  headRefName: string;
  baseRefName: string;
  isCrossRepository: boolean;
};

type Issue = {
  url: string;
  labels: { nodes: { name: string }[] };
  linkedBranches: { nodes: unknown[] };
};

/** The board of a case: the checkout's repository, whether it has a dev branch, the ticket, and the item pages of its project. */
type Board = {
  repository: string;
  dev: boolean;
  issue: unknown;
  boards: Record<string, unknown[][]>;
};

/** What the script prints on stdout, the code it exits with, and its message on stderr, which a case expects empty or containing a part. */
type Result = {
  stdout: string;
  status: number | null;
  message: string;
};

const CASES: {
  name: string;
  args?: string[];
  board: Board;
  expected: Result;
}[] = [
  {
    name: 'a ticket with nothing before it starts on dev',
    board: board({}),
    expected: ok({ start: 'trunk', base: 'dev' }),
  },
  {
    name: 'a repository without dev starts on the default branch',
    board: { ...board({}), dev: false },
    expected: ok({ start: 'trunk', base: 'main' }),
  },
  {
    name: 'a ticket In progress in the same repository without a pull request holds the ticket back',
    board: board({ items: [item('In progress', issue(11, [branch(null)]))] }),
    expected: ok({ start: 'wait', issues: [issueUrl(11)] }),
  },
  {
    name: 'a ticket In review with an open pull request is stacked on',
    board: board({
      items: [
        item('In review', issue(11, [branch(pr(21, 'fix/11-a', 'dev'))])),
      ],
    }),
    expected: ok({
      start: 'stacked',
      base: 'fix/11-a',
      layers: [layer(11, 21, 'fix/11-a', 'dev')],
    }),
  },
  {
    name: 'the open pull requests of a chain stack the ticket on its top',
    board: board({
      items: [
        item(
          'In progress',
          issue(12, [branch(pr(22, 'fix/12-b', 'fix/11-a'))]),
        ),
        item('In review', issue(11, [branch(pr(21, 'fix/11-a', 'dev'))])),
      ],
    }),
    expected: ok({
      start: 'stacked',
      base: 'fix/12-b',
      layers: [
        layer(11, 21, 'fix/11-a', 'dev'),
        layer(12, 22, 'fix/12-b', 'fix/11-a'),
      ],
    }),
  },
  {
    name: 'two open pull requests off dev are two stacks',
    board: board({
      items: [
        item('In review', issue(11, [branch(pr(21, 'fix/11-a', 'dev'))])),
        item('In review', issue(12, [branch(pr(22, 'fix/12-b', 'dev'))])),
      ],
    }),
    expected: ok({
      start: 'split',
      tops: [
        layer(11, 21, 'fix/11-a', 'dev'),
        layer(12, 22, 'fix/12-b', 'dev'),
      ],
    }),
  },
  {
    name: 'a ticket whose pull request is merged is done',
    board: board({
      items: [
        item(
          'In review',
          issue(11, [branch(pr(21, 'fix/11-a', 'dev', 'MERGED'))]),
        ),
      ],
    }),
    expected: ok({ start: 'trunk', base: 'dev' }),
  },
  {
    name: 'a ticket whose pull request is closed holds the ticket back',
    board: board({
      items: [
        item(
          'In progress',
          issue(11, [branch(pr(21, 'fix/11-a', 'dev', 'CLOSED'))]),
        ),
      ],
    }),
    expected: ok({ start: 'wait', issues: [issueUrl(11)] }),
  },
  {
    name: 'a ticket whose branch lives in another repository does not collide',
    board: board({
      items: [item('In progress', issue(11, [branch(null, 'acme/other')]))],
    }),
    expected: ok({ start: 'trunk', base: 'dev' }),
  },
  {
    name: 'tickets Ready, Blocked or Done do not collide',
    board: board({
      items: [
        item('Ready', issue(11, [branch(null)])),
        item('Blocked', issue(12, [branch(pr(22, 'fix/12-b', 'dev'))])),
        item('Done', issue(13, [branch(null)])),
      ],
    }),
    expected: ok({ start: 'trunk', base: 'dev' }),
  },
  {
    name: 'two tickets of different apps do not collide',
    board: board({
      labels: ['app: web'],
      items: [item('In progress', issue(11, [branch(null)], ['app: admin']))],
    }),
    expected: ok({ start: 'trunk', base: 'dev' }),
  },
  {
    name: 'two tickets of a common app collide',
    board: board({
      labels: ['app: web', 'app: admin'],
      items: [item('In progress', issue(11, [branch(null)], ['app: admin']))],
    }),
    expected: ok({ start: 'wait', issues: [issueUrl(11)] }),
  },
  {
    name: 'a ticket without an app collides with every app',
    board: board({
      labels: ['app: web'],
      items: [item('In progress', issue(11, [branch(null)]))],
    }),
    expected: ok({ start: 'wait', issues: [issueUrl(11)] }),
  },
  {
    name: 'the ticket itself on the board does not collide',
    board: board({ items: [item('In progress', issue(10, [branch(null)]))] }),
    expected: ok({ start: 'trunk', base: 'dev' }),
  },
  {
    name: 'a colliding ticket on the second page of the board is found',
    board: board({
      pages: [
        [item('Done', issue(11, []))],
        [item('In progress', issue(12, [branch(null)]))],
      ],
    }),
    expected: ok({ start: 'wait', issues: [issueUrl(12)] }),
  },
  {
    name: 'an open blocker with an open pull request is stacked on',
    board: board({
      blockers: [blocker('OPEN', issue(5, [branch(pr(15, 'fix/5-x', 'dev'))]))],
    }),
    expected: ok({
      start: 'stacked',
      base: 'fix/5-x',
      layers: [layer(5, 15, 'fix/5-x', 'dev')],
    }),
  },
  {
    name: 'an open blocker without a pull request holds the ticket back',
    board: board({ blockers: [blocker('OPEN', issue(5, []))] }),
    expected: ok({ start: 'wait', issues: [issueUrl(5)] }),
  },
  {
    name: 'an open blocker with a pull request from a fork holds the ticket back',
    board: board({
      blockers: [
        blocker(
          'OPEN',
          issue(5, [
            branch({ ...pr(15, 'fix/5-x', 'dev'), isCrossRepository: true }),
          ]),
        ),
      ],
    }),
    expected: ok({ start: 'wait', issues: [issueUrl(5)] }),
  },
  {
    name: 'a closed blocker is done',
    board: board({ blockers: [blocker('CLOSED', issue(5, []))] }),
    expected: ok({ start: 'trunk', base: 'dev' }),
  },
  {
    name: 'a blocker that is also In review is one layer',
    board: board({
      blockers: [blocker('OPEN', issue(5, [branch(pr(15, 'fix/5-x', 'dev'))]))],
      items: [item('In review', issue(5, [branch(pr(15, 'fix/5-x', 'dev'))]))],
    }),
    expected: ok({
      start: 'stacked',
      base: 'fix/5-x',
      layers: [layer(5, 15, 'fix/5-x', 'dev')],
    }),
  },
  {
    name: 'a URL that is no issue',
    args: ['https://github.com/acme/app/pull/10'],
    board: board({}),
    expected: {
      stdout: '',
      status: 1,
      message: 'https://github.com/acme/app/pull/10 is not a GitHub issue URL',
    },
  },
];

let failures = 0;

for (const { name, args = [TICKET], board, expected } of CASES) {
  const actual = run(args, board);
  const passed =
    actual.stdout === expected.stdout &&
    actual.status === expected.status &&
    (expected.message === ''
      ? actual.message === ''
      : actual.message.includes(expected.message));

  if (!passed) {
    failures++;
  }

  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);

  if (!passed) {
    console.log(
      `  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`,
    );
  }
}

console.log(failures === 0 ? 'All cases pass.' : `${failures} case(s) failed.`);

process.exit(failures === 0 ? 0 : 1);

/** Starts the script with the stand-in gh first on the PATH, serving the board of the case. */
function run(args: string[], data: Board): Result {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeGh}:${process.env.PATH}`,
      FAKE_GH_DATA: JSON.stringify(data),
    },
  });

  return {
    stdout: result.stdout.trim(),
    status: result.status,
    message: result.stderr,
  };
}

function ok(decision: unknown): Result {
  return { stdout: JSON.stringify(decision), status: 0, message: '' };
}

function board({
  labels = [],
  blockers = [],
  items = [],
  pages = [items],
}: {
  labels?: string[];
  blockers?: unknown[];
  items?: unknown[];
  pages?: unknown[][];
}): Board {
  return {
    repository: REPOSITORY,
    dev: true,
    issue: {
      url: TICKET,
      labels: { nodes: labels.map(name => ({ name })) },
      blockedBy: { nodes: blockers },
      projectItems: { nodes: [{ project: { id: PROJECT } }] },
    },
    boards: { [PROJECT]: pages },
  };
}

function issueUrl(number: number): string {
  return `https://github.com/${REPOSITORY}/issues/${number}`;
}

function issue(
  number: number,
  branches: unknown[],
  labels: string[] = [],
): Issue {
  return {
    url: issueUrl(number),
    labels: { nodes: labels.map(name => ({ name })) },
    linkedBranches: { nodes: branches },
  };
}

function item(status: string, content: Issue) {
  return { fieldValueByName: { name: status }, content };
}

function blocker(state: 'OPEN' | 'CLOSED', content: Issue) {
  return { ...content, state };
}

function branch(pullRequest: PullRequest | null, repository = REPOSITORY) {
  return {
    ref: {
      repository: { nameWithOwner: repository },
      associatedPullRequests: { nodes: pullRequest ? [pullRequest] : [] },
    },
  };
}

function pr(
  number: number,
  headRefName: string,
  baseRefName: string,
  state: State = 'OPEN',
): PullRequest {
  return { number, state, headRefName, baseRefName, isCrossRepository: false };
}

function layer(
  issueNumber: number,
  pullRequest: number,
  head: string,
  base: string,
) {
  return { issue: issueUrl(issueNumber), pullRequest, head, base };
}

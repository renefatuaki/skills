#!/usr/bin/env node

// Lays out the pane for each case's pull requests and compares the review order and the depths with the expected ones, then parses answers of the GraphQL query, cuts the header and the rows to the pane's width and words the caption of a graphical surface.

import {
  headerCaption,
  headerLine,
  paneRows,
  parsePullRequests,
  rowLine,
} from '../hooks/review-queue/order.mts';
import type {
  HeaderLine,
  OpenPullRequest,
  PaneRow,
  RepositoryPullRequests,
  RowLine,
} from '../hooks/review-queue/order.mts';

/** The numbers of the pull requests in the order of the pane, each with the number it waits on or null. */
type Order = [number, number | null][];

const ORDER_CASES: {
  name: string;
  pullRequests: OpenPullRequest[];
  expected: Order;
}[] = [
  {
    name: 'independent pull requests come oldest first',
    pullRequests: [
      pr(3, { createdAt: '2026-03-01T10:00:00Z' }),
      pr(1, { createdAt: '2026-01-01T10:00:00Z' }),
      pr(2, { createdAt: '2026-02-01T10:00:00Z' }),
    ],
    expected: [
      [1, null],
      [2, null],
      [3, null],
    ],
  },
  {
    name: 'a ready pull request comes before an older draft',
    pullRequests: [
      pr(1, { isDraft: true, createdAt: '2026-01-01T10:00:00Z' }),
      pr(2, { createdAt: '2026-02-01T10:00:00Z' }),
    ],
    expected: [
      [2, null],
      [1, null],
    ],
  },
  {
    name: 'the same creation time falls back to the lower number',
    pullRequests: [pr(8, {}), pr(5, {})],
    expected: [
      [5, null],
      [8, null],
    ],
  },
  {
    name: 'a stack of three is listed base first even when the top was created first',
    pullRequests: [
      pr(12, {
        head: 'top',
        base: 'middle',
        createdAt: '2026-01-01T10:00:00Z',
      }),
      pr(11, {
        head: 'middle',
        base: 'bottom',
        createdAt: '2026-02-01T10:00:00Z',
      }),
      pr(10, {
        head: 'bottom',
        base: 'main',
        createdAt: '2026-03-01T10:00:00Z',
      }),
    ],
    expected: [
      [10, null],
      [11, 10],
      [12, 11],
    ],
  },
  {
    name: 'an unrelated pull request older than the base of a stack comes before the whole stack',
    pullRequests: [
      pr(12, {
        head: 'top',
        base: 'bottom',
        createdAt: '2026-01-01T10:00:00Z',
      }),
      pr(10, {
        head: 'bottom',
        base: 'main',
        createdAt: '2026-03-01T10:00:00Z',
      }),
      pr(20, { createdAt: '2026-02-01T10:00:00Z' }),
    ],
    expected: [
      [20, null],
      [10, null],
      [12, 10],
    ],
  },
  {
    name: 'a free child of the pull request listed last comes before an older unrelated one',
    pullRequests: [
      pr(10, {
        head: 'bottom',
        base: 'main',
        createdAt: '2026-01-01T10:00:00Z',
      }),
      pr(12, {
        head: 'top',
        base: 'bottom',
        createdAt: '2026-03-01T10:00:00Z',
      }),
      pr(20, { createdAt: '2026-02-01T10:00:00Z' }),
    ],
    expected: [
      [10, null],
      [12, 10],
      [20, null],
    ],
  },
  {
    name: 'of two siblings the one with the smaller subtree comes first even when it is newer',
    pullRequests: [
      pr(50, { head: 'root', createdAt: '2026-01-01T10:00:00Z' }),
      pr(51, {
        head: 'long',
        base: 'root',
        createdAt: '2026-02-01T10:00:00Z',
      }),
      pr(52, {
        head: 'leaf',
        base: 'root',
        createdAt: '2026-04-01T10:00:00Z',
      }),
      pr(53, {
        head: 'tip',
        base: 'long',
        createdAt: '2026-03-01T10:00:00Z',
      }),
    ],
    expected: [
      [50, null],
      [52, 50],
      [51, 50],
      [53, 51],
    ],
  },
  {
    name: 'of two siblings the one with the smaller subtree comes first even when it is a draft',
    pullRequests: [
      pr(50, { head: 'root', createdAt: '2026-01-01T10:00:00Z' }),
      pr(51, {
        head: 'long',
        base: 'root',
        createdAt: '2026-02-01T10:00:00Z',
      }),
      pr(52, {
        head: 'leaf',
        base: 'root',
        isDraft: true,
        createdAt: '2026-01-15T10:00:00Z',
      }),
      pr(53, {
        head: 'tip',
        base: 'long',
        createdAt: '2026-03-01T10:00:00Z',
      }),
    ],
    expected: [
      [50, null],
      [52, 50],
      [51, 50],
      [53, 51],
    ],
  },
  {
    name: 'siblings with subtrees of the same size fall back to the age',
    pullRequests: [
      pr(50, { head: 'root', createdAt: '2026-01-01T10:00:00Z' }),
      pr(52, {
        head: 'second',
        base: 'root',
        createdAt: '2026-03-01T10:00:00Z',
      }),
      pr(51, {
        head: 'first',
        base: 'root',
        createdAt: '2026-02-01T10:00:00Z',
      }),
    ],
    expected: [
      [50, null],
      [51, 50],
      [52, 50],
    ],
  },
  {
    name: 'a pull request whose issue is blocked comes after the one that closes the blocker',
    pullRequests: [
      pr(31, {
        closes: [301],
        blockedBy: [300],
        createdAt: '2026-01-01T10:00:00Z',
      }),
      pr(30, { closes: [300], createdAt: '2026-02-01T10:00:00Z' }),
    ],
    expected: [
      [30, null],
      [31, 30],
    ],
  },
  {
    name: 'a pull request blocked through an issue follows its blocker before an older unrelated one',
    pullRequests: [
      pr(30, { closes: [300], createdAt: '2026-01-01T10:00:00Z' }),
      pr(31, {
        closes: [301],
        blockedBy: [300],
        createdAt: '2026-03-01T10:00:00Z',
      }),
      pr(32, { createdAt: '2026-02-01T10:00:00Z' }),
    ],
    expected: [
      [30, null],
      [31, 30],
      [32, null],
    ],
  },
  {
    name: 'a blocker that no listed pull request closes changes nothing',
    pullRequests: [
      pr(31, {
        closes: [301],
        blockedBy: [999],
        createdAt: '2026-01-01T10:00:00Z',
      }),
      pr(30, { closes: [300], createdAt: '2026-02-01T10:00:00Z' }),
    ],
    expected: [
      [31, null],
      [30, null],
    ],
  },
  {
    name: 'a pull request waiting on two names the one listed last',
    pullRequests: [
      pr(3, {
        head: 'c',
        base: 'b',
        closes: [30],
        blockedBy: [10],
        createdAt: '2026-01-01T10:00:00Z',
      }),
      pr(2, {
        head: 'b',
        base: 'main',
        closes: [20],
        createdAt: '2026-02-01T10:00:00Z',
      }),
      pr(1, { closes: [10], createdAt: '2026-03-01T10:00:00Z' }),
    ],
    expected: [
      [2, null],
      [1, null],
      [3, 1],
    ],
  },
  {
    name: 'a cycle keeps every pull request and the free ones go first',
    pullRequests: [
      pr(40, { head: 'x', base: 'y', createdAt: '2026-01-01T10:00:00Z' }),
      pr(41, { head: 'y', base: 'x', createdAt: '2026-02-01T10:00:00Z' }),
      pr(42, { isDraft: true, createdAt: '2026-03-01T10:00:00Z' }),
    ],
    expected: [
      [42, null],
      [40, null],
      [41, 40],
    ],
  },
  {
    name: 'a cycle with a stack on it keeps every pull request',
    pullRequests: [
      pr(43, { head: 'z', base: 'y', createdAt: '2026-03-01T10:00:00Z' }),
      pr(41, { head: 'y', base: 'x', createdAt: '2026-02-01T10:00:00Z' }),
      pr(40, { head: 'x', base: 'y', createdAt: '2026-01-01T10:00:00Z' }),
    ],
    expected: [
      [40, null],
      [41, 40],
      [43, 41],
    ],
  },
  {
    name: 'no pull requests lay out no rows',
    pullRequests: [],
    expected: [],
  },
];

/** The open pull requests of grocery-lens-elysia on 2026-10-17, three stacks on dev that the review order lists in one piece each. */
const ELYSIA = {
  name: 'the stacks of grocery-lens-elysia are each listed in one piece, depth first',
  pullRequests: [
    pr(67, {
      base: 'dev',
      head: 'chore/55',
      createdAt: '2026-10-16T19:58:59Z',
    }),
    pr(69, { base: 'dev', head: 'fix/54', createdAt: '2026-10-16T20:01:35Z' }),
    pr(70, { base: 'dev', head: 'fix/58', createdAt: '2026-10-16T20:15:13Z' }),
    pr(74, {
      base: 'fix/58',
      head: 'fix/59',
      createdAt: '2026-10-16T21:40:01Z',
    }),
    pr(83, {
      base: 'fix/54',
      head: 'fix/68',
      createdAt: '2026-10-16T23:09:31Z',
    }),
    pr(85, {
      base: 'chore/55',
      head: 'chore/64',
      createdAt: '2026-10-16T23:25:33Z',
    }),
    pr(86, {
      base: 'fix/59',
      head: 'chore/80',
      createdAt: '2026-10-16T23:25:38Z',
    }),
    pr(88, {
      base: 'fix/59',
      head: 'fix/63',
      createdAt: '2026-10-16T23:53:30Z',
    }),
    pr(90, {
      base: 'fix/66',
      head: 'fix/65',
      createdAt: '2026-10-17T00:00:02Z',
    }),
    pr(91, {
      base: 'fix/63',
      head: 'fix/66',
      createdAt: '2026-10-17T00:03:12Z',
    }),
    pr(93, {
      base: 'fix/65',
      head: 'fix/79',
      createdAt: '2026-10-17T00:22:43Z',
    }),
    pr(94, {
      base: 'fix/58',
      head: 'fix/57',
      createdAt: '2026-10-17T00:33:11Z',
    }),
  ],
  numbers: [67, 85, 69, 83, 70, 94, 74, 86, 88, 91, 90, 93],
  depths: [0, 1, 0, 1, 0, 1, 1, 2, 2, 3, 4, 5],
};

const REAL_ANSWER = JSON.stringify({
  data: {
    repository: {
      nameWithOwner: 'cli/cli',
      url: 'https://github.com/cli/cli',
      pullRequests: {
        nodes: [
          {
            number: 9847,
            title: '[gh search issues] Support multiple author options',
            url: 'https://github.com/cli/cli/pull/9847',
            isDraft: true,
            createdAt: '2024-10-30T05:40:06Z',
            headRefName: 'shion/9828',
            baseRefName: 'trunk',
            closingIssuesReferences: {
              nodes: [{ number: 9828, blockedBy: { nodes: [] } }],
            },
          },
          {
            number: 10253,
            title: 'Include headRepositoryId when creating a new PR',
            url: 'https://github.com/cli/cli/pull/10253',
            isDraft: false,
            createdAt: '2025-01-16T00:21:47Z',
            headRefName: 'include-head-repository-id',
            baseRefName: 'trunk',
            closingIssuesReferences: {
              nodes: [
                {
                  number: 10093,
                  blockedBy: {
                    nodes: [
                      { number: 10001, state: 'OPEN' },
                      { number: 10002, state: 'CLOSED' },
                      { number: 10001, state: 'OPEN' },
                    ],
                  },
                },
                { number: 10094, blockedBy: { nodes: [] } },
              ],
            },
          },
          {
            number: 10300,
            title: 'No issue',
            url: 'https://github.com/cli/cli/pull/10300',
            isDraft: false,
            createdAt: '2025-02-01T08:00:00Z',
            headRefName: 'no-issue',
            baseRefName: 'trunk',
            closingIssuesReferences: { nodes: [] },
          },
        ],
      },
    },
  },
});

const PARSED: RepositoryPullRequests = {
  repository: { name: 'cli/cli', url: 'https://github.com/cli/cli' },
  pullRequests: [
    {
      number: 9847,
      title: '[gh search issues] Support multiple author options',
      url: 'https://github.com/cli/cli/pull/9847',
      isDraft: true,
      createdAt: '2024-10-30T05:40:06Z',
      head: 'shion/9828',
      base: 'trunk',
      closes: [9828],
      blockedBy: [],
    },
    {
      number: 10253,
      title: 'Include headRepositoryId when creating a new PR',
      url: 'https://github.com/cli/cli/pull/10253',
      isDraft: false,
      createdAt: '2025-01-16T00:21:47Z',
      head: 'include-head-repository-id',
      base: 'trunk',
      closes: [10093, 10094],
      blockedBy: [10001],
    },
    {
      number: 10300,
      title: 'No issue',
      url: 'https://github.com/cli/cli/pull/10300',
      isDraft: false,
      createdAt: '2025-02-01T08:00:00Z',
      head: 'no-issue',
      base: 'trunk',
      closes: [],
      blockedBy: [],
    },
  ],
};

const NO_PULL_REQUESTS =
  '{"data":{"repository":{"nameWithOwner":"o/r","url":"https://github.com/o/r","pullRequests":{"nodes":[]}}}}';

const PARSE_CASES: {
  name: string;
  stdout: string;
  expected: RepositoryPullRequests | null;
}[] = [
  {
    name: 'an answer of the query parses into its pull requests with the open blockers only',
    stdout: REAL_ANSWER,
    expected: PARSED,
  },
  {
    name: 'an answer without pull requests parses into none',
    stdout: NO_PULL_REQUESTS,
    expected: {
      repository: { name: 'o/r', url: 'https://github.com/o/r' },
      pullRequests: [],
    },
  },
  { name: 'empty output is no answer', stdout: '', expected: null },
  { name: 'text is no answer', stdout: 'gh: not found', expected: null },
  { name: 'a JSON array is no answer', stdout: '[]', expected: null },
  { name: 'an empty object is no answer', stdout: '{}', expected: null },
  {
    name: 'a missing repository is no answer',
    stdout: '{"data":{"repository":null}}',
    expected: null,
  },
  {
    name: 'GraphQL errors are no answer',
    stdout: '{"errors":[{"message":"Could not resolve to a Repository"}]}',
    expected: null,
  },
  {
    name: 'a repository without its nameWithOwner is no answer',
    stdout: REAL_ANSWER.replace('"nameWithOwner":"cli/cli",', ''),
    expected: null,
  },
  {
    name: 'a repository whose nameWithOwner is no string is no answer',
    stdout: REAL_ANSWER.replace(
      '"nameWithOwner":"cli/cli"',
      '"nameWithOwner":7',
    ),
    expected: null,
  },
  {
    name: 'a repository without its url is no answer',
    stdout: REAL_ANSWER.replace('"url":"https://github.com/cli/cli",', ''),
    expected: null,
  },
  {
    name: 'a repository whose url is no string is no answer',
    stdout: REAL_ANSWER.replace(
      '"url":"https://github.com/cli/cli",',
      '"url":null,',
    ),
    expected: null,
  },
  {
    name: 'a pull request without a number is no answer',
    stdout: REAL_ANSWER.replace('"number":9847,', ''),
    expected: null,
  },
  {
    name: 'a pull request with a date that is none is no answer',
    stdout: REAL_ANSWER.replace('2024-10-30T05:40:06Z', 'yesterday'),
    expected: null,
  },
  {
    name: 'a blocker without a state is no answer',
    stdout: REAL_ANSWER.replace(',"state":"CLOSED"', ''),
    expected: null,
  },
];

const ROW: PaneRow = {
  position: 2,
  number: 42,
  title: 'Add the parser',
  url: 'https://github.com/o/r/pull/42',
  isDraft: false,
  waitsOn: null,
  depth: 0,
};

const LINE_CASES: {
  name: string;
  row: PaneRow;
  columns: number;
  expected: RowLine;
}[] = [
  {
    name: 'a ready pull request shows its position and its label',
    row: ROW,
    columns: 80,
    expected: { lead: '2. ', label: '#42 Add the parser', notes: '' },
  },
  {
    name: 'a draft that waits on another shows both notes',
    row: { ...ROW, isDraft: true, waitsOn: 41 },
    columns: 80,
    expected: {
      lead: '2. ',
      label: '#42 Add the parser',
      notes: ' draft after #41',
    },
  },
  {
    name: 'a long title is cut with an ellipsis so the notes stay in the width',
    row: { ...ROW, isDraft: true, waitsOn: 41 },
    columns: 36,
    expected: {
      lead: '2. ',
      label: '#42 Add the pars…',
      notes: ' draft after #41',
    },
  },
  {
    name: 'a pull request two deep is indented in the lead and its label still fits the width',
    row: { ...ROW, waitsOn: 41, depth: 2 },
    columns: 30,
    expected: {
      lead: '2.     ',
      label: '#42 Add the …',
      notes: ' after #41',
    },
  },
];

const HEADER_CASES: {
  name: string;
  open: RepositoryPullRequests;
  columns: number;
  expected: HeaderLine;
}[] = [
  {
    name: 'the header shows the repository and the count of its open pull requests',
    open: PARSED,
    columns: 60,
    expected: { label: 'cli/cli', notes: ' · 3 open' },
  },
  {
    name: 'a long repository name is cut with an ellipsis so the count stays in the width',
    open: {
      repository: {
        name: 'renefatuaki/grocery-lens-elysia',
        url: 'https://github.com/renefatuaki/grocery-lens-elysia',
      },
      pullRequests: ELYSIA.pullRequests,
    },
    columns: 24,
    expected: { label: 'renefatuaki/g…', notes: ' · 12 open' },
  },
];

const CAPTION_CASE = {
  name: 'the caption counts the open pull requests and says the order reads top to bottom',
  open: PARSED,
  expected: '3 open · top to bottom',
};

const TITLE_CASE = {
  name: 'a title with line breaks is one line',
  pullRequests: [pr(7, { title: 'Fix\nthe\r\n\tbug ' })],
  expected: 'Fix the bug',
};

let failures = 0;

for (const { name, pullRequests, expected } of ORDER_CASES) {
  failures += report(name, orderOf(paneRows(pullRequests)), expected);
}

const elysiaRows = paneRows(ELYSIA.pullRequests);

failures += report(
  ELYSIA.name,
  [elysiaRows.map(row => row.number), elysiaRows.map(row => row.depth)],
  [ELYSIA.numbers, ELYSIA.depths],
);

failures += report(
  TITLE_CASE.name,
  paneRows(TITLE_CASE.pullRequests)[0]?.title,
  TITLE_CASE.expected,
);

for (const { name, stdout, expected } of PARSE_CASES) {
  failures += report(name, parsePullRequests(stdout), expected);
}

for (const { name, row, columns, expected } of LINE_CASES) {
  failures += report(name, rowLine(row, columns), expected);
}

for (const { name, open, columns, expected } of HEADER_CASES) {
  failures += report(name, headerLine(open, columns), expected);
}

failures += report(
  CAPTION_CASE.name,
  headerCaption(CAPTION_CASE.open),
  CAPTION_CASE.expected,
);

console.log(failures === 0 ? 'All cases pass.' : `${failures} case(s) failed.`);

process.exit(failures === 0 ? 0 : 1);

function orderOf(rows: PaneRow[]): Order {
  return rows.map(row => [row.number, row.waitsOn]);
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

/** Builds a ready pull request on main created on 2026-01-01, with the given fields replacing the defaults. */
function pr(number: number, fields: Partial<OpenPullRequest>): OpenPullRequest {
  return {
    number,
    title: `Pull request ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    isDraft: false,
    createdAt: '2026-01-01T00:00:00Z',
    head: `branch-${number}`,
    base: 'main',
    closes: [],
    blockedBy: [],
    ...fields,
  };
}

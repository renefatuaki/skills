#!/usr/bin/env node

// Lays out the rows for each case's pull requests and compares the review order with the expected one, then parses answers of the GraphQL query and lays out the Markdown table.

import {
  parsePullRequests,
  queueRows,
  queueTable,
} from '../skills/github/review-queue/scripts/order.mts';
import type {
  OpenPullRequest,
  QueueRow,
} from '../skills/github/review-queue/scripts/order.mts';

/** The numbers of the pull requests in the review order, each with the number it waits on or null. */
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
  expected: [
    [67, null],
    [85, 67],
    [69, null],
    [83, 69],
    [70, null],
    [94, 70],
    [74, 70],
    [86, 74],
    [88, 74],
    [91, 88],
    [90, 91],
    [93, 90],
  ] as Order,
};

const REAL_ANSWER = JSON.stringify({
  data: {
    repository: {
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

const PARSED: OpenPullRequest[] = [
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
];

const NO_PULL_REQUESTS =
  '{"data":{"repository":{"pullRequests":{"nodes":[]}}}}';

const PARSE_CASES: {
  name: string;
  stdout: string;
  expected: OpenPullRequest[] | null;
}[] = [
  {
    name: 'an answer of the query parses into its pull requests with the open blockers only',
    stdout: REAL_ANSWER,
    expected: PARSED,
  },
  {
    name: 'an answer without pull requests parses into none',
    stdout: NO_PULL_REQUESTS,
    expected: [],
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

const TABLE_CASES: {
  name: string;
  pullRequests: OpenPullRequest[];
  expected: string;
}[] = [
  {
    name: 'the table links each pull request and names the one it waits on',
    pullRequests: [
      pr(10, { head: 'bottom' }),
      pr(11, { head: 'middle', base: 'bottom', isDraft: true }),
      pr(12, { head: 'top', base: 'middle' }),
      pr(13, { title: '' }),
    ],
    expected: [
      '| # | Pull request | After | Status |',
      '| --- | --- | --- | --- |',
      '| 1 | [#10 Pull request 10](https://github.com/o/r/pull/10) |  | Ready |',
      '| 2 | [#11 Pull request 11](https://github.com/o/r/pull/11) | #10 | Draft |',
      '| 3 | [#12 Pull request 12](https://github.com/o/r/pull/12) | #11 | Ready |',
      '| 4 | [#13](https://github.com/o/r/pull/13) |  | Ready |',
    ].join('\n'),
  },
  {
    name: 'a pipe and brackets in a title are escaped so the cell and the link stay whole',
    pullRequests: [pr(7, { title: 'Fix [a|b] \\ c' })],
    expected: [
      '| # | Pull request | After | Status |',
      '| --- | --- | --- | --- |',
      '| 1 | [#7 Fix \\[a\\|b\\] \\\\ c](https://github.com/o/r/pull/7) |  | Ready |',
    ].join('\n'),
  },
];

const TITLE_CASE = {
  name: 'a title with line breaks is one line',
  pullRequests: [pr(7, { title: 'Fix\nthe\r\n\tbug ' })],
  expected: 'Fix the bug',
};

let failures = 0;

for (const { name, pullRequests, expected } of ORDER_CASES) {
  failures += report(name, orderOf(queueRows(pullRequests)), expected);
}

const elysiaRows = queueRows(ELYSIA.pullRequests);

failures += report(ELYSIA.name, orderOf(elysiaRows), ELYSIA.expected);

failures += report(
  TITLE_CASE.name,
  queueRows(TITLE_CASE.pullRequests)[0]?.title,
  TITLE_CASE.expected,
);

for (const { name, stdout, expected } of PARSE_CASES) {
  failures += report(name, parsePullRequests(stdout), expected);
}

for (const { name, pullRequests, expected } of TABLE_CASES) {
  failures += report(name, queueTable(pullRequests), expected);
}

console.log(failures === 0 ? 'All cases pass.' : `${failures} case(s) failed.`);

process.exit(failures === 0 ? 0 : 1);

function orderOf(rows: QueueRow[]): Order {
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

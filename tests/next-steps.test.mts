#!/usr/bin/env node

// Picks the next action for each case's pull request, reads the open steps of test plans, then parses answers of the GraphQL query and lays out the numbered list.

import {
  nextAction,
  openTestSteps,
  parseSteps,
  stepList,
} from '../skills/github/next-steps/scripts/steps.mts';
import type {
  Action,
  PullRequestStatus,
} from '../skills/github/next-steps/scripts/steps.mts';

const ACTION_CASES: {
  name: string;
  status: PullRequestStatus;
  expected: Action;
}[] = [
  {
    name: 'a draft is finished first, whatever else holds',
    status: status({ isDraft: true, conflicting: true, checks: 'failed' }),
    expected: 'finish',
  },
  {
    name: 'conflicts come before failed checks',
    status: status({ conflicting: true, checks: 'failed' }),
    expected: 'conflicts',
  },
  {
    name: 'failed checks come before requested changes',
    status: status({ checks: 'failed', review: 'changes requested' }),
    expected: 'checks',
  },
  {
    name: 'requested changes are addressed before anything else',
    status: status({ review: 'changes requested', checks: 'passed' }),
    expected: 'changes',
  },
  {
    name: 'a pull request without a review is reviewed while its checks run',
    status: status({ checks: 'running' }),
    expected: 'review',
  },
  {
    name: 'an approved pull request with open test steps is still reviewed',
    status: status({ review: 'approved', openSteps: [2] }),
    expected: 'review',
  },
  {
    name: 'an approved pull request waits for running checks',
    status: status({ review: 'approved', checks: 'running' }),
    expected: 'pending',
  },
  {
    name: 'an approved pull request with passed checks is merged',
    status: status({ review: 'approved', checks: 'passed' }),
    expected: 'merge',
  },
  {
    name: 'an approved pull request without checks is merged',
    status: status({ review: 'approved' }),
    expected: 'merge',
  },
];

const BODY = `## Summary

Adds a camera.

## Test plan

### Steps

- [x] 1. Open the app. The home screen shows.
- [ ] 2. Tap Scan. The camera opens. (needs a person: a physical iPhone for the camera)
- [ ] 3. Scan a code. The product shows.

## Notes for the reviewer

- [ ] 9. Not a step of the plan.`;

const STEP_CASES: { name: string; body: string; expected: number[] }[] = [
  {
    name: 'the unticked steps of the test plan are open, those of other sections are not',
    body: BODY,
    expected: [2, 3],
  },
  {
    name: 'a description without a test plan has no open steps',
    body: '## Summary\n\n- [ ] 1. A checklist outside the plan.',
    expected: [],
  },
];

const ANSWER = answer([
  node(10, {
    title: 'Bottom of the stack',
    headRefName: 'bottom',
    reviewDecision: 'APPROVED',
    commits: rollup('SUCCESS'),
  }),
  node(11, {
    title: 'Top of the stack',
    headRefName: 'top',
    baseRefName: 'bottom',
    body: BODY,
    commits: rollup('PENDING'),
  }),
  node(12, {
    title: 'Fix [the] login',
    mergeable: 'CONFLICTING',
    reviewDecision: null,
    latestReviews: { nodes: [{ state: 'APPROVED' }] },
  }),
]);

const LIST_CASES: { name: string; stdout: string; expected: string | null }[] =
  [
    {
      name: 'a stack and a conflict are listed in review order with their actions',
      stdout: ANSWER,
      expected: [
        '1. Merge [#10 Bottom of the stack](https://github.com/o/r/pull/10).',
        '2. Review [#11 Top of the stack](https://github.com/o/r/pull/11). Open test steps 2, 3. After #10.',
        '3. Resolve the conflicts of [#12 Fix \\[the\\] login](https://github.com/o/r/pull/12).',
      ].join('\n'),
    },
    {
      name: 'an answer without the review fields is no answer',
      stdout: answer([
        { ...node(1, {}), latestReviews: undefined, commits: undefined },
      ]),
      expected: null,
    },
    {
      name: 'text that is not JSON is no answer',
      stdout: 'gh: Not Found',
      expected: null,
    },
  ];

let failures = 0;

for (const { name, status, expected } of ACTION_CASES) {
  failures += report(name, nextAction(status), expected);
}

for (const { name, body, expected } of STEP_CASES) {
  failures += report(name, openTestSteps(body), expected);
}

for (const { name, stdout, expected } of LIST_CASES) {
  const rows = parseSteps(stdout);

  failures += report(name, rows === null ? null : stepList(rows), expected);
}

console.log(failures === 0 ? 'All cases pass.' : `${failures} case(s) failed.`);

process.exit(failures === 0 ? 0 : 1);

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

/** Builds a ready, mergeable pull request without review, checks or open steps, with the given fields replacing the defaults. */
function status(fields: Partial<PullRequestStatus>): PullRequestStatus {
  return {
    number: 1,
    isDraft: false,
    conflicting: false,
    review: 'none',
    checks: 'none',
    openSteps: [],
    ...fields,
  };
}

/** Builds a node of the GraphQL answer for a ready pull request on main created on 2026-01-01, with the given fields replacing the defaults. */
function node(
  number: number,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return {
    mergeable: 'MERGEABLE',
    reviewDecision: 'REVIEW_REQUIRED',
    body: '',
    latestReviews: { nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
    number,
    title: `Pull request ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    isDraft: false,
    createdAt: '2026-01-01T00:00:00Z',
    headRefName: `branch-${number}`,
    baseRefName: 'main',
    closingIssuesReferences: { nodes: [] },
    ...fields,
  };
}

function rollup(state: string): Record<string, unknown> {
  return { nodes: [{ commit: { statusCheckRollup: { state } } }] };
}

function answer(nodes: unknown[]): string {
  return JSON.stringify({
    data: { repository: { pullRequests: { nodes } } },
  });
}

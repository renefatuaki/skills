// Reads the open pull requests of the repository with their review, checks and test plan, picks the next action on each and lays them out as a numbered list in the review order.
// https://docs.github.com/en/graphql/reference/objects#pullrequest

import {
  isNumber,
  nodesOf,
  parsePullRequests,
  pullRequestsQuery,
  queueRows,
  recordOf,
} from '../../review-queue/scripts/order.mts';

/** What the user does next on a pull request. */
export type Action =
  | 'finish'
  | 'conflicts'
  | 'checks'
  | 'changes'
  | 'review'
  | 'pending'
  | 'merge';

/** An open pull request as the next action needs it. */
export type PullRequestStatus = {
  readonly number: number;
  readonly isDraft: boolean;
  readonly conflicting: boolean;
  readonly review: 'approved' | 'changes requested' | 'none';
  readonly checks: 'passed' | 'failed' | 'running' | 'none';
  /** The numbers of the unticked steps of its test plan. */
  readonly openSteps: readonly number[];
};

/** An open pull request at its place in the review order, with its next action. */
export type StepRow = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly action: Action;
  readonly openSteps: readonly number[];
  /** The number of the listed pull request above that this one waits on, null for none. */
  readonly waitsOn: number | null;
};

/** Asks GraphQL for the open pull requests with every field the next action and the review order need. */
export const STEPS_QUERY = pullRequestsQuery(`mergeable
        reviewDecision
        body
        latestReviews(first: 20) {
          nodes {
            state
          }
        }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
              }
            }
          }
        }`);

/** The first action whose test holds, so a blocker such as a conflict comes before the review, and merge when none holds. */
const ACTION_RULES: readonly (readonly [
  Action,
  (status: PullRequestStatus) => boolean,
])[] = [
  ['finish', status => status.isDraft],
  ['conflicts', status => status.conflicting],
  ['checks', status => status.checks === 'failed'],
  ['changes', status => status.review === 'changes requested'],
  ['review', status => status.review === 'none' || status.openSteps.length > 0],
  ['pending', status => status.checks === 'running'],
];

const ACTION_VERBS: Readonly<Record<Action, string>> = {
  finish: 'Finish the draft',
  conflicts: 'Resolve the conflicts of',
  checks: 'Fix the checks of',
  changes: 'Address the requested changes of',
  review: 'Review',
  pending: 'Wait for the checks of',
  merge: 'Merge',
};

const TEST_PLAN_HEADING = /^##\s+Test plan\s*$/i;

const SECTION_HEADING = /^##\s/;

const OPEN_STEP = /^\s*[-*] \[ \] (\d+)\./;

/** Reads the answer of `STEPS_QUERY` into the rows in review order, null when it is not that answer. */
export function parseSteps(stdout: string): StepRow[] | null {
  const pullRequests = parsePullRequests(stdout);
  const statuses = parseStatuses(stdout);

  if (pullRequests === null || statuses === null) {
    return null;
  }

  const byNumber = new Map(statuses.map(status => [status.number, status]));

  return queueRows(pullRequests).map(row => {
    const status = byNumber.get(row.number);

    if (status === undefined) {
      throw new Error(`No status for #${row.number}.`);
    }

    return {
      number: row.number,
      title: row.title,
      url: row.url,
      action: nextAction(status),
      openSteps: status.openSteps,
      waitsOn: row.waitsOn,
    };
  });
}

export function nextAction(status: PullRequestStatus): Action {
  const rule = ACTION_RULES.find(([, applies]) => applies(status));

  return rule?.[0] ?? 'merge';
}

/** Lays out the rows as a numbered Markdown list, one line per pull request. */
export function stepList(rows: readonly StepRow[]): string {
  return rows
    .map((row, index) => {
      const label =
        row.title === '' ? `#${row.number}` : `#${row.number} ${row.title}`;

      const parts = [
        `${index + 1}. ${ACTION_VERBS[row.action]} [${linkText(label)}](${row.url}).`,
      ];

      if (row.action === 'review' && row.openSteps.length > 0) {
        parts.push(`Open test steps ${row.openSteps.join(', ')}.`);
      }

      if (row.waitsOn !== null) {
        parts.push(`After #${row.waitsOn}.`);
      }

      return parts.join(' ');
    })
    .join('\n');
}

/** Reads the numbers of the unticked steps under the test plan heading of a description. */
export function openTestSteps(body: string): number[] {
  const steps: number[] = [];
  let inPlan = false;

  for (const line of body.split(/\r?\n/)) {
    if (SECTION_HEADING.test(line)) {
      inPlan = TEST_PLAN_HEADING.test(line);
      continue;
    }

    const step = inPlan ? OPEN_STEP.exec(line) : null;

    if (step !== null) {
      steps.push(Number(step[1]));
    }
  }

  return steps;
}

function parseStatuses(stdout: string): PullRequestStatus[] | null {
  let value: unknown;

  try {
    value = JSON.parse(stdout);
  } catch {
    return null;
  }

  const repository = recordOf(recordOf(recordOf(value)?.data)?.repository);
  const nodes = nodesOf(repository?.pullRequests);

  if (nodes === null) {
    return null;
  }

  const statuses: PullRequestStatus[] = [];

  for (const node of nodes) {
    const status = parseStatus(node);

    if (status === null) {
      return null;
    }

    statuses.push(status);
  }

  return statuses;
}

function parseStatus(node: unknown): PullRequestStatus | null {
  const pr = recordOf(node);
  const reviews = nodesOf(pr?.latestReviews);
  const commits = nodesOf(pr?.commits);

  if (
    pr === null ||
    reviews === null ||
    commits === null ||
    !isNumber(pr.number) ||
    typeof pr.isDraft !== 'boolean' ||
    typeof pr.mergeable !== 'string' ||
    typeof pr.body !== 'string'
  ) {
    return null;
  }

  const reviewStates = reviews.map(review => recordOf(review)?.state);
  const rollup = recordOf(
    recordOf(recordOf(commits[0])?.commit)?.statusCheckRollup,
  );

  return {
    number: pr.number,
    isDraft: pr.isDraft,
    conflicting: pr.mergeable === 'CONFLICTING',
    review: reviewOf(pr.reviewDecision, reviewStates),
    checks: checksOf(rollup?.state),
    openSteps: openTestSteps(pr.body),
  };
}

/**
 * Takes the review decision, or the latest reviews when the repository requires none and GitHub gives no decision.
 * @see {@link https://docs.github.com/en/graphql/reference/enums#pullrequestreviewdecision | PullRequestReviewDecision}
 */
function reviewOf(
  decision: unknown,
  latestStates: readonly unknown[],
): PullRequestStatus['review'] {
  if (
    decision === 'CHANGES_REQUESTED' ||
    (decision === null && latestStates.includes('CHANGES_REQUESTED'))
  ) {
    return 'changes requested';
  }

  if (
    decision === 'APPROVED' ||
    (decision === null && latestStates.includes('APPROVED'))
  ) {
    return 'approved';
  }

  return 'none';
}

/**
 * Reads the combined state of the checks of the head commit, none when it has no checks.
 * @see {@link https://docs.github.com/en/graphql/reference/enums#statusstate | StatusState}
 */
function checksOf(state: unknown): PullRequestStatus['checks'] {
  switch (state) {
    case 'SUCCESS':
      return 'passed';
    case 'FAILURE':
    case 'ERROR':
      return 'failed';
    case 'PENDING':
    case 'EXPECTED':
      return 'running';
    default:
      return 'none';
  }
}

/** Escapes what would end the link text early. */
function linkText(text: string): string {
  return text.replace(/[\\[\]]/g, '\\$&');
}

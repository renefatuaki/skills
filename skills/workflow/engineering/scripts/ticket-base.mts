#!/usr/bin/env node

// Decides where the Ticket playbook of the engineering skill starts a ticket in the repository of the current checkout: on the trunk, stacked on the top pull request of its open blockers and of the tickets it collides with, or not yet. Prints the decision as JSON.

import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

/** The newest pull request of a branch. */
type PullRequest = {
  number: number;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  headRefName: string;
  baseRefName: string;
  isCrossRepository: boolean;
};

/** A branch an issue links, in the repository the branch lives in. */
type LinkedBranch = {
  repository: string;
  pullRequest: PullRequest | null;
};

/** An issue whose change has to land before the ticket's, an open blocker or a ticket of the board the ticket collides with. */
type Predecessor = { url: string; branches: LinkedBranch[] };

/** An open pull request of a predecessor, a layer the ticket stacks on. */
type Layer = { issue: string; pullRequest: number; head: string; base: string };

/** Where the ticket starts: on the trunk, on the top of the one stack listed bottom to top, not before the listed predecessors have an open pull request, or not while the open pull requests form several stacks with these tops. */
type Decision =
  | { start: 'trunk'; base: string }
  | { start: 'stacked'; base: string; layers: Layer[] }
  | { start: 'wait'; issues: string[] }
  | { start: 'split'; tops: Layer[] };

type BranchNode = {
  ref: {
    repository: { nameWithOwner: string };
    associatedPullRequests: { nodes: PullRequest[] };
  } | null;
};

type LabelNode = { name: string };

/** A page of a project's items, whose content is an issue, a pull request or a draft. */
type BoardPage = {
  pageInfo: { hasNextPage: boolean; endCursor: string };
  nodes: {
    fieldValueByName: { name: string } | null;
    content: {
      url?: string;
      labels: { nodes: LabelNode[] };
      linkedBranches: { nodes: BranchNode[] };
    } | null;
  }[];
};

const USAGE = 'usage: ticket-base.mts <issue-url>';

/** The statuses of a ticket whose session runs or whose pull request is not merged yet. */
const ACTIVE_STATUSES = new Set(['In progress', 'In review']);

const APP_LABEL = 'app: ';

const BRANCHES = `linkedBranches(first: 10) {
  nodes {
    ref {
      repository { nameWithOwner }
      associatedPullRequests(first: 1, orderBy: { field: CREATED_AT, direction: DESC }) {
        nodes { number state headRefName baseRefName isCrossRepository }
      }
    }
  }
}`;

const TICKET_QUERY = `query Ticket($owner: String!, $repo: String!, $number: Int!, $checkoutOwner: String!, $checkoutRepo: String!) {
  checkout: repository(owner: $checkoutOwner, name: $checkoutRepo) {
    defaultBranchRef { name }
    dev: ref(qualifiedName: "refs/heads/dev") { name }
  }
  ticket: repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      url
      labels(first: 50) { nodes { name } }
      blockedBy(first: 50) { nodes { url state ${BRANCHES} } }
      projectItems(first: 20) { nodes { project { id } } }
    }
  }
}`;

const BOARD_QUERY = `query Board($projectId: ID!, $after: String) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
          content {
            ... on Issue { url labels(first: 50) { nodes { name } } ${BRANCHES} }
          }
        }
      }
    }
  }
}`;

// 1. Read the ticket from the command line and the repository of the checkout.
// https://nodejs.org/api/util.md#utilparseargsconfig
const { positionals } = parseArgs({ allowPositionals: true });

if (positionals.length !== 1) {
  fail(USAGE);
}

const checkout = gh([
  'repo',
  'view',
  '--json',
  'nameWithOwner',
  '--jq',
  '.nameWithOwner',
]).trim();

// 2. Read the trunk, the ticket's apps, its open blockers and the projects that hold it.
// https://docs.github.com/en/graphql/reference/objects.md#issue
const ticket = readTicket(positionals[0], checkout);

// 3. Read the tickets of those projects that collide with the ticket.
const colliding = ticket.projectIds.flatMap(projectId =>
  readCollidingTickets(projectId, ticket.url, ticket.apps, checkout),
);

console.log(
  JSON.stringify(
    decide([...ticket.blockers, ...colliding], checkout, ticket.trunk),
  ),
);

/** Stacks the ticket on its predecessors' open pull requests, counts a merged one as done since its issue closes only on the default branch, and waits for any without either. */
function decide(
  predecessors: Predecessor[],
  repository: string,
  trunk: string,
): Decision {
  const layers = new Map<number, Layer>();
  const waiting = new Set<string>();

  for (const predecessor of predecessors) {
    const pullRequests = predecessor.branches
      .filter(branch => branch.repository === repository)
      .map(branch => branch.pullRequest);

    const open = pullRequests.find(
      pullRequest =>
        pullRequest?.state === 'OPEN' && !pullRequest.isCrossRepository,
    );

    if (open) {
      layers.set(open.number, {
        issue: predecessor.url,
        pullRequest: open.number,
        head: open.headRefName,
        base: open.baseRefName,
      });
    } else if (
      !pullRequests.some(pullRequest => pullRequest?.state === 'MERGED')
    ) {
      waiting.add(predecessor.url);
    }
  }

  if (waiting.size > 0) {
    return { start: 'wait', issues: [...waiting] };
  }

  if (layers.size === 0) {
    return { start: 'trunk', base: trunk };
  }

  const bases = new Set([...layers.values()].map(layer => layer.base));
  const tops = [...layers.values()].filter(layer => !bases.has(layer.head));

  if (tops.length > 1) {
    return { start: 'split', tops };
  }

  return {
    start: 'stacked',
    base: tops[0].head,
    layers: stackBelow(tops[0], [...layers.values()]),
  };
}

/** Lists the layers from the bottom up to the top, following each layer's base to the layer whose head it is. */
function stackBelow(top: Layer, layers: Layer[]): Layer[] {
  const stack = [top];
  let below = layers.find(layer => layer.head === top.base);

  while (below) {
    stack.unshift(below);
    below = layers.find(layer => layer.head === stack[0].base);
  }

  return stack;
}

/** Reads the trunk of the checkout and the issue with its apps, open blockers and projects. */
function readTicket(
  issueUrl: string,
  repository: string,
): {
  url: string;
  trunk: string;
  apps: string[];
  blockers: Predecessor[];
  projectIds: string[];
} {
  const { owner, repo, number } = parseIssueUrl(issueUrl);
  const [checkoutOwner, checkoutRepo] = repository.split('/');
  const { checkout, ticket } = graphql(TICKET_QUERY, {
    owner,
    repo,
    number,
    checkoutOwner,
    checkoutRepo,
  });

  const issue = ticket.issue;

  return {
    url: issue.url,
    trunk: checkout.dev?.name ?? checkout.defaultBranchRef.name,
    apps: apps(issue.labels.nodes),
    blockers: issue.blockedBy.nodes
      .filter((blocker: { state: string }) => blocker.state === 'OPEN')
      .map(
        (blocker: {
          url: string;
          linkedBranches: { nodes: BranchNode[] };
        }) => ({
          url: blocker.url,
          branches: linkedBranches(blocker.linkedBranches.nodes),
        }),
      ),
    projectIds: issue.projectItems.nodes.map(
      (item: { project: { id: string } }) => item.project.id,
    ),
  };
}

/**
 * Reads the tickets of a project that are In progress or In review, link a branch in this repository, and share an app with the ticket unless one of them names none.
 * @see {@link https://docs.github.com/en/graphql/reference/objects.md#projectv2item | ProjectV2Item}
 */
function readCollidingTickets(
  projectId: string,
  ticketUrl: string,
  ticketApps: string[],
  repository: string,
): Predecessor[] {
  const colliding: Predecessor[] = [];
  let after: string | null = null;

  do {
    const items: BoardPage = graphql(BOARD_QUERY, { projectId, after }).node
      .items;

    for (const item of items.nodes) {
      const issue = item.content;

      if (
        !issue?.url ||
        issue.url === ticketUrl ||
        !ACTIVE_STATUSES.has(item.fieldValueByName?.name ?? '')
      ) {
        continue;
      }

      const branches = linkedBranches(issue.linkedBranches.nodes);
      const otherApps = apps(issue.labels.nodes);
      const separateApps =
        ticketApps.length > 0 &&
        otherApps.length > 0 &&
        !otherApps.some(app => ticketApps.includes(app));

      if (
        branches.some(branch => branch.repository === repository) &&
        !separateApps
      ) {
        colliding.push({ url: issue.url, branches });
      }
    }

    after = items.pageInfo.hasNextPage ? items.pageInfo.endCursor : null;
  } while (after);

  return colliding;
}

function linkedBranches(nodes: BranchNode[]): LinkedBranch[] {
  return nodes.flatMap(({ ref }) =>
    ref
      ? [
          {
            repository: ref.repository.nameWithOwner,
            pullRequest: ref.associatedPullRequests.nodes[0] ?? null,
          },
        ]
      : [],
  );
}

function apps(labels: LabelNode[]): string[] {
  return labels
    .map(label => label.name)
    .filter(name => name.startsWith(APP_LABEL))
    .map(name => name.slice(APP_LABEL.length));
}

/** Splits `https://github.com/<owner>/<repo>/issues/<number>` into its parts. */
function parseIssueUrl(issueUrl: string): {
  owner: string;
  repo: string;
  number: number;
} {
  const match =
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/.exec(
      issueUrl,
    );

  if (!match) {
    fail(`${issueUrl} is not a GitHub issue URL`);
  }

  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

/** Runs a GraphQL query through gh and returns its data. */
function graphql(query: string, variables: Record<string, unknown>) {
  const body = JSON.stringify({ query, variables });

  return JSON.parse(gh(['api', 'graphql', '--input', '-'], body)).data;
}

/**
 * Runs gh with the input on stdin and returns its stdout, while its stderr goes straight to the terminal.
 * @see {@link https://nodejs.org/api/child_process.md#child_processexecfilesyncfile-args-options | Node.js, child_process.execFileSync}
 */
function gh(args: string[], input?: string): string {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

#!/usr/bin/env node

// Prints the tickets of a GitHub Project that are still open, each with its Status, Priority, Size, labels, epic, open blockers and open pull requests, as the JSON the today-issues skill plans from.

import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

/** Another issue a ticket points at, its parent or one end of a blocked-by edge. */
type IssueRef = {
  number: number;
  url: string;
};

/** An open issue of the project that is not Done and is assigned to the viewer or to nobody. */
type Ticket = {
  number: number;
  title: string;
  url: string;
  repository: string;
  status: string | null;
  priority: string | null;
  size: string | null;
  labels: string[];
  assignees: string[];
  parent: IssueRef | null;
  subIssues: { total: number; completed: number };
  blockedBy: IssueRef[];
  pullRequests: { number: number; url: string; isDraft: boolean }[];
};

/** The value of a single-select field on an item, null while the field is empty. */
type SelectValue = { name: string } | null;

type LinkedIssue = IssueRef & { state: 'OPEN' | 'CLOSED' };

/** An issue as the query returns it. */
type IssueNode = {
  __typename: 'Issue';
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED';
  repository: { nameWithOwner: string };
  assignees: { nodes: { login: string }[] };
  labels: { nodes: { name: string }[] };
  parent: IssueRef | null;
  subIssuesSummary: { total: number; completed: number };
  blockedBy: { nodes: LinkedIssue[] };
  closedByPullRequestsReferences: {
    nodes: { number: number; url: string; isDraft: boolean }[];
  };
};

/** An item of the project, whose content is null when the viewer may not read it. */
type ItemNode = {
  status: SelectValue;
  priority: SelectValue;
  size: SelectValue;
  content: IssueNode | { __typename: 'PullRequest' | 'DraftIssue' } | null;
};

type ItemPage = {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: ItemNode[];
};

const USAGE = 'usage: read-board.mts <number> --owner <owner>';

const ITEMS_QUERY = `query($projectId: ID!, $cursor: String) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          priority: fieldValueByName(name: "Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          size: fieldValueByName(name: "Size") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          content {
            __typename
            ... on Issue {
              number
              title
              url
              state
              repository { nameWithOwner }
              assignees(first: 20) { nodes { login } }
              labels(first: 50) { nodes { name } }
              parent { number url }
              subIssuesSummary { total completed }
              blockedBy(first: 50) { nodes { number url state } }
              closedByPullRequestsReferences(first: 10, includeClosedPrs: false) { nodes { number url isDraft } }
            }
          }
        }
      }
    }
  }
}`;

// 1. Read the project number and the owner from the command line.
// https://nodejs.org/api/util.md#utilparseargsconfig
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    owner: { type: 'string' },
  },
});

const [number] = positionals;

if (positionals.length !== 1 || !values.owner) {
  fail(USAGE);
}

// 2. Read the project and the login whose tickets count.
// https://cli.github.com/manual/gh_project_view
const projectView = gh([
  'project',
  'view',
  number,
  '--owner',
  values.owner,
  '--format',
  'json',
]);

const project: { id: string; title: string; url: string } =
  JSON.parse(projectView);

const viewer = gh(['api', 'user', '--jq', '.login']).trim();

// 3. Read every item of the project, a hundred per request.
const items: ItemNode[] = [];
let cursor: string | null = null;

do {
  const page = readItemPage(project.id, cursor);

  items.push(...page.nodes);
  cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
} while (cursor);

// 4. Keep the tickets that are still open work for the viewer and print them.
const tickets = items
  .map(toTicket)
  .filter(ticket => ticket !== null)
  .filter(ticket => isAssignedToViewerOrNobody(ticket, viewer));

console.log(
  JSON.stringify({
    project: { title: project.title, url: project.url },
    viewer,
    tickets,
  }),
);

/**
 * Reads one page of the project's items.
 * @see {@link https://docs.github.com/en/graphql/reference/projects.md#projectv2 | ProjectV2}
 */
function readItemPage(projectId: string, cursor: string | null): ItemPage {
  const body = JSON.stringify({
    query: ITEMS_QUERY,
    variables: { projectId, cursor },
  });

  const response = JSON.parse(gh(['api', 'graphql', '--input', '-'], body));

  return response.data.node.items;
}

/** Turns an item into a ticket, or into null when it is no open issue or is Done. */
function toTicket({
  status,
  priority,
  size,
  content,
}: ItemNode): Ticket | null {
  if (content?.__typename !== 'Issue') {
    return null;
  }

  if (content.state !== 'OPEN' || status?.name === 'Done') {
    return null;
  }

  return {
    number: content.number,
    title: content.title,
    url: content.url,
    repository: content.repository.nameWithOwner,
    status: status?.name ?? null,
    priority: priority?.name ?? null,
    size: size?.name ?? null,
    labels: content.labels.nodes.map(label => label.name),
    assignees: content.assignees.nodes.map(assignee => assignee.login),
    parent: content.parent,
    subIssues: content.subIssuesSummary,
    blockedBy: openIssues(content.blockedBy.nodes),
    pullRequests: content.closedByPullRequestsReferences.nodes,
  };
}

/** Keeps the open issues of a blocked-by edge, because a closed blocker holds nothing back. */
function openIssues(issues: LinkedIssue[]): IssueRef[] {
  return issues
    .filter(issue => issue.state === 'OPEN')
    .map(({ number, url }) => ({ number, url }));
}

function isAssignedToViewerOrNobody(ticket: Ticket, viewer: string): boolean {
  return ticket.assignees.length === 0 || ticket.assignees.includes(viewer);
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

// Parses the open pull requests of the repository and puts them in the order to review them and lays out the header and the rows of the pane, with no Node and no engine.
// https://docs.github.com/en/graphql/reference/objects#pullrequest

/** The open pull requests of one repository. */
export type RepositoryPullRequests = {
  readonly repository: {
    /** The `nameWithOwner`, such as `cli/cli`. */
    readonly name: string;
    readonly url: string;
  };
  readonly pullRequests: readonly OpenPullRequest[];
};

/** An open pull request of the repository as the review order needs it. */
export type OpenPullRequest = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly isDraft: boolean;
  /** ISO 8601. */
  readonly createdAt: string;
  /** The `headRefName`. */
  readonly head: string;
  /** The `baseRefName`. */
  readonly base: string;
  /** The numbers of its closing issues. */
  readonly closes: readonly number[];
  /** The numbers of the open issues that block any of its closing issues. */
  readonly blockedBy: readonly number[];
};

/** One line of the pane, the pull request at its place in the review order. */
export type PaneRow = {
  /** Counts from 1. */
  readonly position: number;
  readonly number: number;
  /** The title on one line. */
  readonly title: string;
  readonly url: string;
  readonly isDraft: boolean;
  /** The number of the listed pull request above that this one waits on, null for none. */
  readonly waitsOn: number | null;
  /** The number of listed pull requests in the chain it waits on, 0 when it waits on none. */
  readonly depth: number;
};

/** A row cut to the pane's width, the label being the part that links to the pull request. */
export type RowLine = {
  readonly lead: string;
  readonly label: string;
  /** The dim part after the label, empty for a ready pull request that waits on none. */
  readonly notes: string;
};

/** The header of the pane cut to its width, the label being the repository that links to its pull requests. */
export type HeaderLine = {
  readonly label: string;
  /** The dim count after the label, such as ` · 3 open`. */
  readonly notes: string;
};

/** A free pull request as the review order weighs it. */
type Candidate = {
  readonly pr: OpenPullRequest;
  /** The index in the review order of its predecessor listed last, -1 for none. */
  readonly affinity: number;
  /** The number of pull requests that come after it, directly or through others. */
  readonly subtree: number;
};

/** Asks GraphQL for the repository `gh` runs in and its open pull requests, the oldest first. */
export const PULL_REQUESTS_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    url
    pullRequests(states: OPEN, first: 100, orderBy: {field: CREATED_AT, direction: ASC}) {
      nodes {
        number
        title
        url
        isDraft
        createdAt
        headRefName
        baseRefName
        closingIssuesReferences(first: 20) {
          nodes {
            number
            blockedBy(first: 50) {
              nodes {
                number
                state
              }
            }
          }
        }
      }
    }
  }
}`;

/** Reads the answer of `PULL_REQUESTS_QUERY`, null when it is not that answer. */
export function parsePullRequests(
  stdout: string,
): RepositoryPullRequests | null {
  let value: unknown;

  try {
    value = JSON.parse(stdout);
  } catch {
    return null;
  }

  const data = recordOf(value)?.data;
  const repository = recordOf(recordOf(data)?.repository);
  const nodes = nodesOf(repository?.pullRequests);

  if (
    repository === null ||
    nodes === null ||
    typeof repository.nameWithOwner !== 'string' ||
    typeof repository.url !== 'string'
  ) {
    return null;
  }

  const pullRequests: OpenPullRequest[] = [];

  for (const node of nodes) {
    const pr = parsePr(node);

    if (pr === null) {
      return null;
    }

    pullRequests.push(pr);
  }

  return {
    repository: { name: repository.nameWithOwner, url: repository.url },
    pullRequests,
  };
}

/** Puts the pull requests in the order to review them, each after the ones it builds on and each stack in one piece, depth first. */
export function reviewOrder(
  pullRequests: readonly OpenPullRequest[],
): OpenPullRequest[] {
  const subtrees = new Map(
    pullRequests.map(pr => [pr, descendantCount(pr, pullRequests)]),
  );

  const remaining = [...pullRequests];
  const ordered: OpenPullRequest[] = [];

  while (remaining.length > 0) {
    const free = remaining.filter(
      pr => !remaining.some(other => comesBefore(other, pr)),
    );

    // A cycle leaves no pull request free, and the best of all of them goes first so none is lost.
    const candidates = (free.length > 0 ? free : remaining).map(pr => ({
      pr,
      affinity: ordered.findLastIndex(other => comesBefore(other, pr)),
      subtree: subtrees.get(pr) ?? 0,
    }));

    const next = candidates.reduce((best, candidate) =>
      byStack(candidate, best) < 0 ? candidate : best,
    ).pr;

    ordered.push(next);
    remaining.splice(remaining.indexOf(next), 1);
  }

  return ordered;
}

/** Lays out the review order as the rows of the pane. */
export function paneRows(pullRequests: readonly OpenPullRequest[]): PaneRow[] {
  const ordered = reviewOrder(pullRequests);
  const depths = new Map<OpenPullRequest, number>();

  return ordered.map((pr, index) => {
    const waitsOn = ordered
      .slice(0, index)
      .findLast(other => comesBefore(other, pr));

    const depth = waitsOn === undefined ? 0 : (depths.get(waitsOn) ?? 0) + 1;

    depths.set(pr, depth);

    return {
      position: index + 1,
      number: pr.number,
      title: singleLine(pr.title),
      url: pr.url,
      isDraft: pr.isDraft,
      waitsOn: waitsOn?.number ?? null,
      depth,
    };
  });
}

/** Cuts the label so lead, label and notes fit the columns, the lead indenting the label two spaces per depth. */
export function rowLine(row: PaneRow, columns: number): RowLine {
  const lead = `${row.position}. ${'  '.repeat(row.depth)}`;
  const label =
    row.title === '' ? `#${row.number}` : `#${row.number} ${row.title}`;

  const notes = `${row.isDraft ? ' draft' : ''}${row.waitsOn === null ? '' : ` after #${row.waitsOn}`}`;

  return {
    lead,
    label: cutTo(label, columns - width(lead) - width(notes)),
    notes,
  };
}

/** Cuts the repository's name so it and the count of its open pull requests fit the columns. */
export function headerLine(
  open: RepositoryPullRequests,
  columns: number,
): HeaderLine {
  const notes = ` · ${open.pullRequests.length} open`;

  return {
    label: cutTo(open.repository.name, columns - width(notes)),
    notes,
  };
}

/** Says how many pull requests are open and which way the review order reads, the caption under the repository on a graphical surface. */
export function headerCaption(open: RepositoryPullRequests): string {
  return `${open.pullRequests.length} open · top to bottom`;
}

/** Tells whether the first pull request has to be reviewed before the second, because the second is stacked on it or closes an issue that the first one's issue blocks. */
function comesBefore(first: OpenPullRequest, second: OpenPullRequest): boolean {
  return (
    first !== second &&
    (second.base === first.head ||
      second.blockedBy.some(issue => first.closes.includes(issue)))
  );
}

/** Orders the child of the pull request listed last first, then among children the smaller subtree, then by `byTieBreak`, negative when the first goes first. */
function byStack(first: Candidate, second: Candidate): number {
  return (
    second.affinity - first.affinity ||
    (first.affinity === -1 ? 0 : first.subtree - second.subtree) ||
    byTieBreak(first.pr, second.pr)
  );
}

/** Counts the pull requests that come after this one, directly or through others. */
function descendantCount(
  root: OpenPullRequest,
  pullRequests: readonly OpenPullRequest[],
): number {
  const reached = new Set([root]);

  // A Set visits the values added while it is walked, so this reaches the whole subtree once.
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set/forEach
  reached.forEach(pr => {
    for (const other of pullRequests) {
      if (comesBefore(pr, other)) {
        reached.add(other);
      }
    }
  });

  return reached.size - 1;
}

/** Orders ready before draft, then oldest, then the lower number, negative when the first goes first. */
function byTieBreak(first: OpenPullRequest, second: OpenPullRequest): number {
  return (
    Number(first.isDraft) - Number(second.isDraft) ||
    Date.parse(first.createdAt) - Date.parse(second.createdAt) ||
    first.number - second.number
  );
}

function parsePr(node: unknown): OpenPullRequest | null {
  const pr = recordOf(node);
  const issues = parseIssues(nodesOf(pr?.closingIssuesReferences));

  if (
    pr === null ||
    issues === null ||
    !isNumber(pr.number) ||
    typeof pr.title !== 'string' ||
    typeof pr.url !== 'string' ||
    typeof pr.isDraft !== 'boolean' ||
    typeof pr.createdAt !== 'string' ||
    Number.isNaN(Date.parse(pr.createdAt)) ||
    typeof pr.headRefName !== 'string' ||
    typeof pr.baseRefName !== 'string'
  ) {
    return null;
  }

  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    isDraft: pr.isDraft,
    createdAt: pr.createdAt,
    head: pr.headRefName,
    base: pr.baseRefName,
    ...issues,
  };
}

/** Reads the closing issues of a pull request into their numbers and the numbers of their open blockers, null when one is malformed. */
function parseIssues(
  nodes: unknown[] | null,
): Pick<OpenPullRequest, 'closes' | 'blockedBy'> | null {
  if (nodes === null) {
    return null;
  }

  const closes = new Set<number>();
  const blockedBy = new Set<number>();

  for (const node of nodes) {
    const issue = recordOf(node);
    const blockers = nodesOf(issue?.blockedBy);

    if (issue === null || blockers === null || !isNumber(issue.number)) {
      return null;
    }

    closes.add(issue.number);

    for (const node of blockers) {
      const blocker = recordOf(node);

      if (
        blocker === null ||
        !isNumber(blocker.number) ||
        typeof blocker.state !== 'string'
      ) {
        return null;
      }

      if (blocker.state === 'OPEN') {
        blockedBy.add(blocker.number);
      }
    }
  }

  return { closes: [...closes], blockedBy: [...blockedBy] };
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Reads the `nodes` of a GraphQL connection. */
function nodesOf(connection: unknown): unknown[] | null {
  const nodes = recordOf(connection)?.nodes;

  return Array.isArray(nodes) ? nodes : null;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** Turns every run of line breaks and control characters into one space, so a title draws on one line. */
function singleLine(title: string): string {
  return title.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').trim();
}

/** Cuts the text to the columns of the room, its last one an ellipsis when it does not fit. */
function cutTo(text: string, room: number): string {
  return width(text) <= room
    ? text
    : `${[...text].slice(0, Math.max(0, room - 1)).join('')}…`;
}

/** Counts a character as one column, with the outer Text cutting at the cell edge for a wide glyph. */
function width(text: string): number {
  return [...text].length;
}

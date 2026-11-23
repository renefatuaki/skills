#!/usr/bin/env node

// Cleans up after the user's merged pull requests in the repository of the current folder, or in each repository one level below it, and prints as JSON what it removed, what it kept and which issues are left to close.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** A worktree of the repository as `git worktree list --porcelain` prints it. */
type Worktree = {
  readonly path: string;
  /** The checked-out branch, null for a detached HEAD. */
  readonly branch: string | null;
};

/** A repository as the run reads it before it removes anything. */
type Repository = {
  /** The folder of the main checkout. */
  readonly path: string;
  readonly nameWithOwner: string;
  /** The default branch and dev, which no run deletes. */
  readonly trunks: ReadonlySet<string>;
  /** The bases of the open pull requests, which no run deletes either. */
  readonly openBases: ReadonlySet<string>;
  /** The worktrees, the main checkout first. */
  readonly worktrees: readonly Worktree[];
  /** The tip of each local branch by its name. */
  readonly branches: ReadonlyMap<string, string>;
  /** The tip of each branch on origin by its name. */
  readonly remoteBranches: ReadonlyMap<string, string>;
};

/** An issue the body of a pull request names after a closing keyword or after `Refs`. */
type IssueReference = {
  /** The `owner/name` of the repository that holds the issue. */
  readonly repository: string;
  readonly number: number;
  readonly closes: boolean;
};

/** A step of the test plan that names a criterion of the issue, which the step proves once its checkbox is ticked. */
type CriterionStep = {
  readonly criterion: number;
  readonly isTicked: boolean;
};

type MergedPullRequest = {
  readonly number: number;
  readonly url: string;
  readonly branch: string;
  /** The last commit of the pull request. */
  readonly head: string;
  /** In body order, each issue once. */
  readonly issues: readonly IssueReference[];
  readonly criteria: readonly CriterionStep[];
};

/** A pull request as `gh pr list --json` prints it. */
type PullRequestNode = {
  number: number;
  url: string;
  headRefName: string;
  headRefOid: string;
  body: string;
};

/** Something a merged pull request left behind, with the reason it stays when the run kept it. */
type Leftover = {
  readonly kind: 'worktree' | 'directory' | 'branch' | 'remote branch';
  /** The path of a worktree or a directory, the name of a branch. */
  readonly name: string;
  readonly keptBecause?: string;
};

/** An open issue that a merged pull request closes, with the criteria of the ticked and the unticked steps of its test plan. */
type IssueToClose = {
  readonly url: string;
  readonly proven: readonly number[];
  readonly unproven: readonly number[];
};

type PullRequestReport = {
  readonly number: number;
  readonly url: string;
  readonly branch: string;
  readonly removed: readonly Leftover[];
  readonly kept: readonly Leftover[];
  readonly closes: readonly IssueToClose[];
  /** The URLs of the open issues it names after `Refs`. */
  readonly refers: readonly string[];
};

type RepositoryReport =
  | {
      readonly path: string;
      readonly pullRequests: readonly PullRequestReport[];
      readonly fastForward: string;
    }
  | { readonly path: string; readonly error: string };

/** A git or gh command that exited with an error, its message the first line it wrote to stderr. */
class CommandError extends Error {}

/** How many of the merged pull requests the run reads, the most recently updated first. */
const MERGED_LIMIT = 100;

const OPEN_LIMIT = 1000;

/** Matches a closing keyword or `Refs` and the issue after it, as `#12`, `owner/name#12` or an issue URL. */
const ISSUE_REFERENCE =
  /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs)\b:?\s+(?:(?:https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+)(?:#|\/issues\/)|#)(\d+)\b/gi;

/** Matches a step of the test plan that names a criterion, capturing its checkbox mark and the criterion's number. */
const CRITERION_STEP = /^- \[([ xX])\].*\(criterion (\d+)\)/gm;

/** Matches an HTML comment, such as the hints a pull request template leaves in the body. */
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

const KEPT_FOR_COMMITS = 'has commits that the pull request does not hold';

const checkouts = findMainCheckouts(process.cwd());

if (checkouts.length === 0) {
  fail(
    'No git repository holds the current folder or lies one level below it.',
  );
}

console.log(
  JSON.stringify({ repositories: checkouts.map(cleanRepository) }, null, 2),
);

/** Returns the main checkout of the repository that holds the folder, otherwise that of each repository one level below it, each once. */
function findMainCheckouts(folder: string): string[] {
  if (isInRepository(folder)) {
    return [mainCheckout(folder)];
  }

  const repositories = readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(folder, entry.name))
    .filter(child => existsSync(join(child, '.git')) && isInRepository(child))
    .sort();

  return [...new Set(repositories.map(mainCheckout))];
}

function isInRepository(folder: string): boolean {
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: folder,
    encoding: 'utf8',
  });

  return result.stdout.trim() === 'true';
}

function mainCheckout(folder: string): string {
  return readWorktrees(folder)[0].path;
}

/** Cleans one repository and reports it, or reports why the run could not clean it. */
function cleanRepository(path: string): RepositoryReport {
  try {
    const repository = readRepository(path);
    const pullRequests = readMergedPullRequests(repository);
    const openIssues = readOpenIssues(path, pullRequests);

    const reports = pullRequests
      .map(pr => cleanPullRequest(repository, pr, openIssues))
      .filter(report => report !== null);

    return {
      path,
      pullRequests: reports,
      fastForward: fastForward(repository),
    };
  } catch (error) {
    return { path, error: commandFailure(error) };
  }
}

/** Drops the records of worktrees whose folder is gone, fetches origin and reads the branches, the worktrees and the bases of the open pull requests. */
function readRepository(path: string): Repository {
  git(path, ['worktree', 'prune']);
  git(path, ['fetch', '--prune', '--quiet', 'origin']);

  // https://cli.github.com/manual/gh_repo_view
  const view: { nameWithOwner: string; defaultBranchRef: { name: string } } =
    JSON.parse(
      gh(path, ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef']),
    );

  // https://cli.github.com/manual/gh_pr_list
  const openPullRequests: { baseRefName: string }[] = JSON.parse(
    gh(path, [
      'pr',
      'list',
      '--repo',
      view.nameWithOwner,
      '--state',
      'open',
      '--limit',
      String(OPEN_LIMIT),
      '--json',
      'baseRefName',
    ]),
  );

  return {
    path,
    nameWithOwner: view.nameWithOwner,
    trunks: new Set([view.defaultBranchRef.name, 'dev']),
    openBases: new Set(openPullRequests.map(pr => pr.baseRefName)),
    worktrees: readWorktrees(path),
    branches: readBranches(path, 'refs/heads/'),
    remoteBranches: readBranches(path, 'refs/remotes/origin/'),
  };
}

/**
 * Reads the worktrees of the repository, the main checkout first.
 * @see {@link https://git-scm.com/docs/git-worktree#_porcelain_format | git worktree, porcelain format}
 */
function readWorktrees(path: string): Worktree[] {
  return git(path, ['worktree', 'list', '--porcelain'])
    .split('\n\n')
    .filter(record => record.trim() !== '')
    .map(record => {
      const lines = record.split('\n');
      const branch = lines.find(line => line.startsWith('branch refs/heads/'));

      return {
        path: lines[0].slice('worktree '.length),
        branch: branch?.slice('branch refs/heads/'.length) ?? null,
      };
    });
}

/** Reads the tip of every branch under the ref prefix, keyed by the name after the prefix. */
function readBranches(path: string, prefix: string): Map<string, string> {
  const lines = git(path, [
    'for-each-ref',
    '--format=%(objectname) %(refname)',
    prefix,
  ])
    .split('\n')
    .filter(line => line !== '');

  return new Map(
    lines.map(line => {
      const [tip, ref] = line.split(' ');

      return [ref.slice(prefix.length), tip];
    }),
  );
}

/**
 * Reads the merged pull requests that involve the user, the most recently updated first.
 * @see {@link https://cli.github.com/manual/gh_pr_list | gh pr list}
 */
function readMergedPullRequests(repository: Repository): MergedPullRequest[] {
  const nodes: PullRequestNode[] = JSON.parse(
    gh(repository.path, [
      'pr',
      'list',
      '--repo',
      repository.nameWithOwner,
      '--state',
      'merged',
      '--search',
      'involves:@me sort:updated-desc',
      '--limit',
      String(MERGED_LIMIT),
      '--json',
      'number,url,headRefName,headRefOid,body',
    ]),
  );

  return nodes.map(node => {
    const body = node.body.replace(HTML_COMMENT, '');

    return {
      number: node.number,
      url: node.url,
      branch: node.headRefName,
      head: node.headRefOid,
      issues: parseIssueReferences(body, repository.nameWithOwner),
      criteria: parseCriterionSteps(body),
    };
  });
}

/** Reads the issues the body names, the last keyword deciding for an issue named twice. */
function parseIssueReferences(
  body: string,
  repository: string,
): IssueReference[] {
  const references = new Map<string, IssueReference>();

  for (const [, keyword, owner, name, number] of body.matchAll(
    ISSUE_REFERENCE,
  )) {
    const reference: IssueReference = {
      repository: owner === undefined ? repository : `${owner}/${name}`,
      number: Number(number),
      closes: keyword.toLowerCase() !== 'refs',
    };

    references.set(issueUrl(reference), reference);
  }

  return [...references.values()];
}

function parseCriterionSteps(body: string): CriterionStep[] {
  return [...body.matchAll(CRITERION_STEP)].map(([, mark, criterion]) => ({
    criterion: Number(criterion),
    isTicked: mark !== ' ',
  }));
}

/**
 * Reads which issues the pull requests name are still open, as their URLs.
 * @see {@link https://cli.github.com/manual/gh_issue_list | gh issue list}
 */
function readOpenIssues(
  path: string,
  pullRequests: readonly MergedPullRequest[],
): Set<string> {
  const repositories = new Set(
    pullRequests.flatMap(pr => pr.issues.map(issue => issue.repository)),
  );

  const urls = [...repositories].flatMap(repository => {
    const issues: { url: string }[] = JSON.parse(
      gh(path, [
        'issue',
        'list',
        '--repo',
        repository,
        '--state',
        'open',
        '--limit',
        String(OPEN_LIMIT),
        '--json',
        'url',
      ]),
    );

    return issues.map(issue => issue.url);
  });

  return new Set(urls);
}

/** Removes what the merged pull request left behind and reports it with its open issues, null when it left nothing. */
function cleanPullRequest(
  repository: Repository,
  pr: MergedPullRequest,
  openIssues: ReadonlySet<string>,
): PullRequestReport | null {
  const isProtected =
    repository.trunks.has(pr.branch) || repository.openBases.has(pr.branch);

  const tip = isProtected ? undefined : repository.branches.get(pr.branch);
  const remoteTip = isProtected
    ? undefined
    : repository.remoteBranches.get(pr.branch);

  const openReferences = pr.issues.filter(issue =>
    openIssues.has(issueUrl(issue)),
  );

  const closes = openReferences.filter(issue => issue.closes);

  if (tip === undefined && remoteTip === undefined && closes.length === 0) {
    return null;
  }

  // 1. Compare both tips with the pull request before anything goes, so a failed read removes nothing.
  const isBranchHeld =
    tip !== undefined && isHeldByPullRequest(repository, pr, tip);

  const isRemoteBranchHeld =
    remoteTip !== undefined && isHeldByPullRequest(repository, pr, remoteTip);

  const leftovers: Leftover[] = [];

  // 2. Remove the local branch with its worktree, or keep both when the branch holds more than the pull request.
  if (isBranchHeld) {
    leftovers.push(...removeBranch(repository, pr.branch));
  } else if (tip !== undefined) {
    leftovers.push(...keepBranch(repository, pr.branch));
  }

  // 3. Remove the branch on GitHub the same way.
  if (isRemoteBranchHeld) {
    leftovers.push(removeRemoteBranch(repository, pr.branch));
  } else if (remoteTip !== undefined) {
    leftovers.push({
      kind: 'remote branch',
      name: pr.branch,
      keptBecause: KEPT_FOR_COMMITS,
    });
  }

  return {
    number: pr.number,
    url: pr.url,
    branch: pr.branch,
    removed: leftovers.filter(leftover => leftover.keptBecause === undefined),
    kept: leftovers.filter(leftover => leftover.keptBecause !== undefined),
    closes: closes.map(issue => issueToClose(pr, issue)),
    refers: openReferences.filter(issue => !issue.closes).map(issueUrl),
  };
}

/** Pairs the issue with the criteria of the test plan when the pull request closes it first, since its steps name the criteria of that issue, a criterion proven once every step that names it is ticked. */
function issueToClose(
  pr: MergedPullRequest,
  issue: IssueReference,
): IssueToClose {
  const steps =
    pr.issues.find(reference => reference.closes) === issue ? pr.criteria : [];

  const unproven = new Set(
    steps.filter(step => !step.isTicked).map(step => step.criterion),
  );

  const proven = new Set(
    steps
      .map(step => step.criterion)
      .filter(criterion => !unproven.has(criterion)),
  );

  return { url: issueUrl(issue), proven: [...proven], unproven: [...unproven] };
}

/** Removes the local branch with the linked worktree that has it checked out, and keeps the branch while that worktree stays. */
function removeBranch(repository: Repository, branch: string): Leftover[] {
  const worktree = linkedWorktree(repository, branch);
  const worktreeLeftovers =
    worktree === undefined ? [] : removeWorktree(repository, worktree);

  const isWorktreeKept = worktreeLeftovers.some(
    leftover =>
      leftover.kind === 'worktree' && leftover.keptBecause !== undefined,
  );

  if (isWorktreeKept) {
    return [
      ...worktreeLeftovers,
      { kind: 'branch', name: branch, keptBecause: 'its worktree stays' },
    ];
  }

  return [
    ...worktreeLeftovers,
    removeOrKeep({ kind: 'branch', name: branch }, () =>
      git(repository.path, ['branch', '--delete', '--force', branch]),
    ),
  ];
}

/** Keeps the local branch that holds commits beyond the pull request, and the linked worktree that has it checked out. */
function keepBranch(repository: Repository, branch: string): Leftover[] {
  const worktree = linkedWorktree(repository, branch);
  const keptBranch: Leftover = {
    kind: 'branch',
    name: branch,
    keptBecause: KEPT_FOR_COMMITS,
  };

  if (worktree === undefined) {
    return [keptBranch];
  }

  return [
    {
      kind: 'worktree',
      name: worktree.path,
      keptBecause: `its branch ${KEPT_FOR_COMMITS}`,
    },
    keptBranch,
  ];
}

function linkedWorktree(
  repository: Repository,
  branch: string,
): Worktree | undefined {
  return repository.worktrees
    .slice(1)
    .find(candidate => candidate.branch === branch);
}

/**
 * Removes a worktree without uncommitted changes to tracked files, its untracked and ignored files with it, and keeps the folder when git could not delete every file.
 * @see {@link https://git-scm.com/docs/git-worktree#Documentation/git-worktree.txt-remove | git worktree remove}
 */
function removeWorktree(
  repository: Repository,
  worktree: Worktree,
): Leftover[] {
  const leftover: Leftover = { kind: 'worktree', name: worktree.path };
  const cwd = process.cwd();

  if (cwd === worktree.path || cwd.startsWith(`${worktree.path}/`)) {
    return [{ ...leftover, keptBecause: 'holds the current directory' }];
  }

  const changes = git(worktree.path, [
    'status',
    '--porcelain',
    '--untracked-files=no',
  ]);

  if (changes.trim() !== '') {
    return [
      { ...leftover, keptBecause: 'has uncommitted changes to tracked files' },
    ];
  }

  try {
    git(repository.path, ['worktree', 'remove', '--force', worktree.path]);

    return [leftover];
  } catch (error) {
    const reason = commandFailure(error);
    const isRegistered = readWorktrees(repository.path).some(
      candidate => candidate.path === worktree.path,
    );

    if (isRegistered) {
      return [{ ...leftover, keptBecause: reason }];
    }

    return [
      leftover,
      { kind: 'directory', name: worktree.path, keptBecause: reason },
    ];
  }
}

/**
 * Deletes the branch on GitHub through the API, so no push hook runs.
 * @see {@link https://docs.github.com/en/rest/git/refs.md#delete-a-reference | Delete a reference}
 */
function removeRemoteBranch(repository: Repository, branch: string): Leftover {
  return removeOrKeep({ kind: 'remote branch', name: branch }, () =>
    gh(repository.path, [
      'api',
      '--method',
      'DELETE',
      `repos/${repository.nameWithOwner}/git/refs/heads/${branch}`,
    ]),
  );
}

/**
 * Tells whether the pull request holds every commit up to the tip, compared by patch, so a branch that GitHub rebased in a stack still counts.
 * @see {@link https://git-scm.com/docs/git-cherry | git cherry}
 */
function isHeldByPullRequest(
  repository: Repository,
  pr: MergedPullRequest,
  tip: string,
): boolean {
  if (tip === pr.head) {
    return true;
  }

  // GitHub keeps the last commit of every pull request under refs/pull, also once its branch is gone.
  // https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/checking-out-pull-requests-locally.md
  git(repository.path, [
    'fetch',
    '--quiet',
    'origin',
    `refs/pull/${pr.number}/head`,
  ]);

  return !git(repository.path, ['cherry', pr.head, tip])
    .split('\n')
    .some(line => line.startsWith('+'));
}

/** Fast-forwards the main checkout when it is on a trunk, and says what happened. */
function fastForward(repository: Repository): string {
  const [{ path, branch }] = repository.worktrees;

  if (branch === null || !repository.trunks.has(branch)) {
    return `The main checkout is on ${branch ?? 'a detached HEAD'} and stays there.`;
  }

  const before = git(path, ['rev-parse', 'HEAD']).trim();

  try {
    git(path, ['merge', '--ff-only', '--quiet', `origin/${branch}`]);
  } catch (error) {
    return `${branch} is not fast-forwarded. ${commandFailure(error)}`;
  }

  const after = git(path, ['rev-parse', 'HEAD']).trim();

  if (before === after) {
    return `${branch} is up to date with origin.`;
  }

  return `${branch} is fast-forwarded from ${before.slice(0, 7)} to ${after.slice(0, 7)}.`;
}

/** Runs the removal and returns the leftover as removed, or as kept with the message of the command when the removal fails. */
function removeOrKeep(leftover: Leftover, removal: () => void): Leftover {
  try {
    removal();

    return leftover;
  } catch (error) {
    return { ...leftover, keptBecause: commandFailure(error) };
  }
}

function issueUrl(issue: IssueReference): string {
  return `https://github.com/${issue.repository}/issues/${issue.number}`;
}

/** Returns the message of a failed git or gh command and rethrows every other error. */
function commandFailure(error: unknown): string {
  if (error instanceof CommandError) {
    return error.message;
  }

  throw error;
}

function git(cwd: string, args: readonly string[]): string {
  return run('git', cwd, args);
}

function gh(cwd: string, args: readonly string[]): string {
  return run('gh', cwd, args);
}

/**
 * Runs the command in the folder and returns its stdout, or throws its first line of stderr as a CommandError.
 * @see {@link https://nodejs.org/api/child_process.md#child_processspawnsynccommand-args-options | Node.js, child_process.spawnSync}
 */
function run(
  command: 'git' | 'gh',
  cwd: string,
  args: readonly string[],
): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });

  if (result.status !== 0) {
    throw new CommandError(
      result.stderr.split('\n').find(line => line.trim() !== ''),
    );
  }

  return result.stdout;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

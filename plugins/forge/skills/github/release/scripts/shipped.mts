// Picks the merged pull requests whose merge commit a release ships, with the issues each one closes and the steps of its test plan still unticked.

import { openTestSteps } from '../../next-steps/scripts/steps.mts';

/** A merged pull request as `gh pr list --json number,title,url,body,mergeCommit` prints it. */
export type MergedPullRequest = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly body: string;
  readonly mergeCommit: { readonly oid: string };
};

/** A pull request a release ships. */
export type ShippedPullRequest = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  /** The issues its description closes, `#<n>` in its own repository and `<owner>/<repo>#<n>` in another. */
  readonly issues: readonly string[];
  readonly openSteps: readonly number[];
};

/**
 * Matches a closing keyword with the issue it closes, which GitHub accepts in any letter case and with a colon after the keyword.
 * @see {@link https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue.md#linking-a-pull-request-to-an-issue-using-a-keyword | GitHub, linking a pull request to an issue using a keyword}
 */
const CLOSING_REFERENCE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/gi;

const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/** Keeps the pull requests whose merge commit is one of `commits`, in the order of their numbers. */
export function shippedPullRequests(
  merged: readonly MergedPullRequest[],
  commits: ReadonlySet<string>,
  repository: string,
): ShippedPullRequest[] {
  return merged
    .filter(pullRequest => commits.has(pullRequest.mergeCommit.oid))
    .sort((first, second) => first.number - second.number)
    .map(pullRequest => ({
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      issues: closedIssues(pullRequest.body, repository),
      openSteps: openTestSteps(pullRequest.body),
    }));
}

/** Collects the issues of all pull requests once each, in the order they first appear. */
export function releaseIssues(
  shipped: readonly ShippedPullRequest[],
): string[] {
  return [...new Set(shipped.flatMap(pullRequest => pullRequest.issues))];
}

/** Reads the issues a description closes, leaving out the comments a template keeps, which can hold an example such as `Closes #123`. */
export function closedIssues(body: string, repository: string): string[] {
  const text = body.replace(HTML_COMMENT, '');
  const issues = [...text.matchAll(CLOSING_REFERENCE)].map(
    ([, nameWithOwner, number]) =>
      nameWithOwner === undefined ||
      nameWithOwner.toLowerCase() === repository.toLowerCase()
        ? `#${number}`
        : `${nameWithOwner}#${number}`,
  );

  return [...new Set(issues)];
}

#!/usr/bin/env node

// Builds the prefill URL of a GitHub issue, from a form or blank, from the issue as JSON on stdin, and refuses one GitHub would reject as too long.

/** The issue as the skill hands it over, either a form with field values keyed by the id of the form field, or a blank issue with its body and labels. */
type Issue = {
  repo: string;
  title: string;
  assignees?: string[];
  milestone?: string;
  projects?: string[];
} & (
  | { template: string; fields?: Record<string, string> }
  | { body: string; labels?: string[] }
);

/** GitHub answers a longer URL with a server error, measured on 2026-09-26. */
const URL_BYTE_LIMIT = 7000;

/** Reports input the script cannot use, the script exits with code 2. */
class InvalidIssueError extends Error {}

/** Reports a URL above the limit, the script exits with code 1. */
class UrlTooLongError extends Error {}

try {
  const issue = parseIssue(await readStdin());
  const url = buildPrefillUrl(issue);

  ensureWithinLimit(url);
  console.log(url);
} catch (error) {
  if (error instanceof UrlTooLongError) {
    exitWith(1, error);
  }

  if (error instanceof InvalidIssueError) {
    exitWith(2, error);
  }

  throw error;
}

async function readStdin(): Promise<string> {
  let input = '';

  for await (const chunk of process.stdin) {
    input += chunk;
  }

  return input;
}

/** Parses the issue and rejects one without repo or title, or without exactly one of template and body. */
function parseIssue(json: string): Issue {
  let issue: Issue;

  try {
    issue = JSON.parse(json);
  } catch (error) {
    throw new InvalidIssueError(
      `stdin is not valid JSON, ${(error as Error).message}`,
    );
  }

  for (const key of ['repo', 'title'] as const) {
    if (!issue[key]) {
      throw new InvalidIssueError(`${key} is missing`);
    }
  }

  if ('template' in issue === 'body' in issue) {
    throw new InvalidIssueError('give either template or body');
  }

  return issue;
}

/**
 * Builds the URL with every field value as a parameter named by the field id.
 * @see {@link https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue.md#creating-an-issue-from-a-url-query | Creating an issue from a URL query}
 */
function buildPrefillUrl(issue: Issue): string {
  const { repo, title, assignees = [], milestone, projects = [] } = issue;
  const parameters = [['title', title]];

  if ('template' in issue) {
    parameters.unshift(['template', issue.template]);
    parameters.push(...Object.entries(issue.fields ?? {}));
  } else {
    parameters.push(['body', issue.body]);

    if (issue.labels?.length) {
      parameters.push(['labels', issue.labels.join(',')]);
    }
  }

  if (assignees.length > 0) {
    parameters.push(['assignees', assignees.join(',')]);
  }

  if (milestone) {
    parameters.push(['milestone', milestone]);
  }

  if (projects.length > 0) {
    parameters.push(['projects', projects.join(',')]);
  }

  const query = parameters
    .map(([name, value]) => `${name}=${encodeQueryValue(value)}`)
    .join('&');

  return `https://github.com/${repo}/issues/new?${query}`;
}

/** Leaves slashes unencoded, so projects reads owner/number as GitHub documents it. */
function encodeQueryValue(value: string): string {
  return encodeURIComponent(value).replace(/%2F/g, '/');
}

function ensureWithinLimit(url: string): void {
  const byteLength = Buffer.byteLength(url);

  if (byteLength <= URL_BYTE_LIMIT) {
    return;
  }

  const excess = byteLength - URL_BYTE_LIMIT;

  throw new UrlTooLongError(
    `The URL is ${byteLength} bytes, the limit is ${URL_BYTE_LIMIT}. Cut ${excess} bytes from the values.`,
  );
}

function exitWith(code: number, error: Error): never {
  console.error(error.message);
  process.exit(code);
}

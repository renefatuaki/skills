#!/usr/bin/env node

// Builds the prefill URL of a GitHub issue form from the issue as JSON on stdin, and refuses one GitHub would reject as too long.

/** The issue as the skill hands it over, field values keyed by the id of the form field. */
type Issue = {
  repo: string;
  template: string;
  title: string;
  fields?: Record<string, string>;
  assignees?: string[];
  milestone?: string;
  projects?: string[];
};

// GitHub answers a longer URL with a server error, measured on 2026-09-26.
const URL_BYTE_LIMIT = 7000;

class InvalidIssueError extends Error {}
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

/** Parses the issue and rejects one without repo, template or title. */
function parseIssue(json: string): Issue {
  let issue: Issue;

  try {
    issue = JSON.parse(json);
  } catch (error) {
    throw new InvalidIssueError(
      `stdin is not valid JSON, ${(error as Error).message}`,
    );
  }

  for (const key of ['repo', 'template', 'title'] as const) {
    if (!issue[key]) {
      throw new InvalidIssueError(`${key} is missing`);
    }
  }

  return issue;
}

/**
 * Builds the URL with every field value as a parameter named by the field id.
 * @see {@link https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue.md#creating-an-issue-from-a-url-query | Creating an issue from a URL query}
 */
function buildPrefillUrl({
  repo,
  template,
  title,
  fields = {},
  assignees = [],
  milestone,
  projects = [],
}: Issue): string {
  const parameters = [
    ['template', template],
    ['title', title],
    ...Object.entries(fields),
  ];

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

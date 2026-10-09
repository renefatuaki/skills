#!/usr/bin/env node

// Sets the Status of a GitHub issue in every project that holds it, and prints the projects it changed and those without that option, as the JSON the implement-issue skill reports from.

import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

/** An item of a project that holds the issue, as `gh issue view --json projectItems` prints it. */
type ProjectItem = {
  id: string;
  project: { id: string; title: string };
  status: { optionId: string; name: string } | null;
};

/** The Status field of a project with its options, null when the project has no single-select Status. */
type StatusField = {
  id: string;
  options: { id: string; name: string }[];
} | null;

type Change = { project: string; from: string | null; to: string };

type Miss = { project: string; options: string[] };

const USAGE = 'usage: set-status.mts <issue-url> <status>';

const STATUS_FIELD_QUERY = `query($projectId: ID!) {
  node(id: $projectId) {
    ... on ProjectV2 {
      field(name: "Status") {
        ... on ProjectV2SingleSelectField { id options { id name } }
      }
    }
  }
}`;

// 1. Read the issue and the status from the command line.
// https://nodejs.org/api/util.md#utilparseargsconfig
const { positionals } = parseArgs({ allowPositionals: true });

const [url, status] = positionals;

if (positionals.length !== 2) {
  fail(USAGE);
}

// 2. Read the items of the issue, one per project that holds it.
// https://cli.github.com/manual/gh_issue_view
const issueView = gh(['issue', 'view', url, '--json', 'projectItems']);

const items: ProjectItem[] = JSON.parse(issueView).projectItems;

if (items.length === 0) {
  fail(`${url} belongs to no project`);
}

// 3. Set the status on every item whose project offers it.
const changed: Change[] = [];
const missing: Miss[] = [];

for (const item of items) {
  const field = readStatusField(item.project.id);
  const option = field?.options.find(candidate => candidate.name === status);

  if (!field || !option) {
    missing.push({
      project: item.project.title,
      options: field?.options.map(candidate => candidate.name) ?? [],
    });

    continue;
  }

  editItem(item, field.id, option.id);
  changed.push({
    project: item.project.title,
    from: item.status?.name ?? null,
    to: status,
  });
}

console.log(JSON.stringify({ status, changed, missing }));

/**
 * Reads the Status field of a project with its options.
 * @see {@link https://docs.github.com/en/graphql/reference/objects.md#projectv2singleselectfield | ProjectV2SingleSelectField}
 */
function readStatusField(projectId: string): StatusField {
  const body = JSON.stringify({
    query: STATUS_FIELD_QUERY,
    variables: { projectId },
  });

  const response = JSON.parse(gh(['api', 'graphql', '--input', '-'], body));

  return response.data.node.field;
}

/**
 * Sets the single-select option of an item's field.
 * @see {@link https://cli.github.com/manual/gh_project_item-edit | gh project item-edit}
 */
function editItem(item: ProjectItem, fieldId: string, optionId: string): void {
  gh([
    'project',
    'item-edit',
    '--project-id',
    item.project.id,
    '--id',
    item.id,
    '--field-id',
    fieldId,
    '--single-select-option-id',
    optionId,
  ]);
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

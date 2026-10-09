#!/usr/bin/env node

// Brings the Status, Priority and Size fields of a GitHub Project in line with assets/project.json, and drops options the project has beyond it only with --drop.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

/** An option as assets/project.json defines it, with the id of the project's option of the same name once paired. */
type Option = {
  name: string;
  color: string;
  description: string;
  id?: string;
};

type Field = {
  name: string;
  options: Option[];
};

/** A field as `gh project field-list` prints it, options only on a single-select field. */
type ProjectField = {
  id: string;
  name: string;
  options?: {
    id: string;
    name: string;
  }[];
};

/** What to write to one field, its options paired with their ids, and the option names the write would drop. */
type Plan = {
  name: string;
  fieldId: string;
  options: Option[];
  beyondFieldSet: string[];
};

/** The field as the mutation returns it after the update. */
type UpdatedField = {
  name: string;
  options: Pick<Option, 'name' | 'color'>[];
};

const USAGE = 'usage: sync-project.mts <number> --owner <owner> [--drop]';

// 1. Read the project number, the owner and --drop from the command line.
// https://nodejs.org/api/util.md#utilparseargsconfig
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    owner: { type: 'string' },
    drop: { type: 'boolean', default: false },
  },
});

const [number] = positionals;

if (positionals.length !== 1 || !values.owner) {
  fail(USAGE);
}

// 2. Read the field set from the asset and the fields the project has now.
// https://cli.github.com/manual/gh_project_field-list
const fieldSetPath = new URL('../assets/project.json', import.meta.url);
const fieldSet: Field[] = JSON.parse(readFileSync(fieldSetPath, 'utf8')).fields;
const fieldList = gh([
  'project',
  'field-list',
  number,
  '--owner',
  values.owner,
  '--format',
  'json',
]);

const projectFields: ProjectField[] = JSON.parse(fieldList).fields;

// 3. Plan every field of the set against the project.
const plans = fieldSet.map(field => planField(field, projectFields));

// 4. Stop before dropping options the project has beyond the set, unless --drop was given, because their items lose the value.
const plansWithOptionsBeyondSet = plans.filter(
  plan => plan.beyondFieldSet.length > 0,
);

if (plansWithOptionsBeyondSet.length > 0 && !values.drop) {
  const lines = plansWithOptionsBeyondSet.map(
    plan => `${plan.name}: ${plan.beyondFieldSet.join(', ')}`,
  );

  fail(
    `These options are not in the field set and would be dropped, with the value of every item that carries them. Run again with --drop to drop them.\n${lines.join('\n')}`,
  );
}

// 5. Apply every plan and print each field with its options and colors.
for (const plan of plans) {
  const field = updateField(plan);
  const options = field.options
    .map(option => `${option.name} ${option.color}`)
    .join(', ');

  console.log(`${field.name}: ${options}`);
}

/** Plans one field, with the option ids to keep item values and the option names the project has beyond the set. */
function planField(field: Field, projectFields: ProjectField[]): Plan {
  // 1. Find the project's field of the same name.
  const current = projectFields.find(
    candidate => candidate.name === field.name,
  );

  if (!current) {
    fail(`The project has no field named ${field.name}, create it first.`);
  }

  // 2. Give every option of the set the id of the project's option of the same name, so its items keep their value.
  const idsByName = new Map(
    (current.options ?? []).map(option => [option.name, option.id]),
  );

  const options = field.options.map(option => ({
    ...option,
    id: idsByName.get(option.name),
  }));

  // 3. Collect the option names the project has that the set does not.
  const setNames = new Set(field.options.map(option => option.name));
  const beyondFieldSet = [...idsByName.keys()].filter(
    name => !setNames.has(name),
  );

  return { name: field.name, fieldId: current.id, options, beyondFieldSet };
}

/**
 * Replaces the field's options, where an option with an id is updated in place and one without is created.
 * @see {@link https://docs.github.com/en/graphql/reference/projects.md#updateprojectv2field---mutation | updateProjectV2Field}
 */
function updateField({ fieldId, options }: Plan): UpdatedField {
  const query = `mutation($fieldId: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]) {
    updateProjectV2Field(input: {fieldId: $fieldId, singleSelectOptions: $options}) {
      projectV2Field { ... on ProjectV2SingleSelectField { name options { name color } } }
    }
  }`;

  const body = JSON.stringify({ query, variables: { fieldId, options } });
  const response = JSON.parse(gh(['api', 'graphql', '--input', '-'], body));

  return response.data.updateProjectV2Field.projectV2Field;
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

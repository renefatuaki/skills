#!/usr/bin/env node

// Ticks the passed steps in the test plan of a pull request and clears every other checkbox of the plan, so the description shows the latest test run.

import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

/** A step of the test plan, with the number its checkbox carries. */
type Step = {
  number: number;
  passed: boolean;
};

type MarkedPlan = {
  body: string;
  steps: Step[];
};

const USAGE = 'usage: mark-steps.mts <number> [--passed 1,2,4]';

// The headings and the checkbox as the pull-request skill's template writes them.
const TEST_PLAN_HEADING = /^##\s+Test plan\s*$/i;
const SECTION_HEADING = /^##\s/;
const STEP_CHECKBOX = /^(\s*[-*] \[)[ xX](\] (\d+)\.)/;

// 1. Read the pull request number and the passed steps from the command line.
// https://nodejs.org/api/util.html#utilparseargsconfig
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    passed: { type: 'string', default: '' },
  },
});

const [number] = positionals;
const passed = new Set(values.passed.split(',').filter(Boolean).map(Number));

if (positionals.length !== 1 || [...passed].some(Number.isNaN)) {
  fail(USAGE);
}

// 2. Read the description of the pull request.
// https://cli.github.com/manual/gh_pr_view
const view = gh(['pr', 'view', number, '--json', 'body']);
const body: string = JSON.parse(view).body;

// 3. Mark the steps and stop when the plan lacks a step that was reported as passed.
const plan = markSteps(body, passed);
const numbers = new Set(plan.steps.map(step => step.number));
const missing = [...passed].filter(step => !numbers.has(step));

if (plan.steps.length === 0) {
  fail('The description has no numbered checkbox under "## Test plan".');
}

if (missing.length > 0) {
  fail(`The test plan has no step ${missing.join(', ')}.`);
}

// 4. Write the description back when a checkbox changed.
// https://cli.github.com/manual/gh_pr_edit
if (plan.body !== body) {
  gh(['pr', 'edit', number, '--body-file', '-'], plan.body);
}

// 5. Print every step with its mark.
for (const step of plan.steps) {
  console.log(`${step.number} ${step.passed ? 'passed' : 'open'}`);
}

/** Sets the checkbox of every numbered step between the test plan heading and the next section, and leaves every other line as it is. */
function markSteps(body: string, passed: Set<number>): MarkedPlan {
  const steps: Step[] = [];
  let insidePlan = false;

  const lines = body.split('\n').map(line => {
    if (SECTION_HEADING.test(line)) {
      insidePlan = TEST_PLAN_HEADING.test(line);
    }

    const checkbox = insidePlan ? STEP_CHECKBOX.exec(line) : null;

    if (!checkbox) {
      return line;
    }

    const stepNumber = Number(checkbox[3]);
    const isPassed = passed.has(stepNumber);

    steps.push({ number: stepNumber, passed: isPassed });

    return line.replace(STEP_CHECKBOX, `$1${isPassed ? 'x' : ' '}$2`);
  });

  return { body: lines.join('\n'), steps };
}

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

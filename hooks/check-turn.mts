#!/usr/bin/env node

// Notes when a turn starts and which files its Edits and Writes are about to touch, then blocks the end of the turn once when a file it changed breaks a rule.
// https://code.claude.com/docs/en/hooks.md

import {
  agentChanges,
  type Discovery,
  noteEdit,
  noteTurnStart,
  turnChanges,
} from './lib/changes.mts';
import { comments } from './lib/comments.mts';
import { diagramSyntax, linkedDiagrams } from './lib/diagrams.mts';
import { docs } from './lib/docs.mts';
import {
  blockStop,
  checkSafely,
  FAILED,
  type Finding,
  parseTurnEvent,
  readHookInput,
  type RuleSet,
  segmentsBelow,
  UNCHECKED,
} from './lib/hook.mts';

/** The findings of one rule set across every root, in the order of the roots and then of the files. */
type Section = {
  heading: string;
  findings: Finding[];
};

/** Everything a blocked stop tells: the sections of findings, the rule sets that threw, the files a rule set never started and the checkouts whose changes were never listed. */
type Report = {
  sections: Section[];
  failures: string[];
  unchecked: string[];
  skipped: string[];
};

/** Every rule set in the order its section stands in the reason. The one list a new rule set joins. */
const RULE_SETS: RuleSet[] = [comments, docs, diagramSyntax, linkedDiagrams];

/** Opens the reason, which Claude reads as its instruction for the rest of the turn. */
const INTRO =
  'The forge Stop hook checked every file this turn changed. Fix each line below, then end the turn.';

/** The time a stop gets to check files, which leaves the rest of the 30 seconds the host allows to print the reason. */
const DEFAULT_BUDGET_MS = 25_000;

/** The time in epoch milliseconds after which no git call and no file starts. */
const deadline = Date.now() + readBudgetMs();

await main();

async function main(): Promise<void> {
  const event = parseTurnEvent(readHookInput());

  if (event === null) {
    return;
  }

  switch (event.kind) {
    case 'prompt':
      noteTurnStart(event.session, event.cwd);
      break;
    case 'edit':
      noteEdit(event.session, event.agent, event.path);
      break;
    case 'stop':
      // A stop that a hook already blocked once stays silent, so a fix that breaks a rule again can never trap the turn.
      // https://code.claude.com/docs/en/hooks.md
      if (!event.continuing) {
        await blockOnFindings(
          event.cwd,
          turnChanges(event.session, event.cwd, deadline),
        );
      }

      break;
    case 'subagent-stop':
      if (!event.continuing) {
        await blockOnFindings(
          event.cwd,
          agentChanges(event.session, event.cwd, event.agent, deadline),
        );
      }

      break;

    default: {
      const unhandled: never = event;

      throw new Error(`unhandled turn event ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Runs every rule set over every root and blocks the stop with all findings, silent when there is none. */
async function blockOnFindings(
  cwd: string,
  { changes, skipped }: Discovery,
): Promise<void> {
  // 1. Give every root the deadline, and run each rule set over all of them. Each rule set builds its linter or parser once per root, and one that throws costs only its own findings.
  const sections: Section[] = [];

  for (const ruleSet of RULE_SETS) {
    const findings: Finding[] = [];

    for (const root of changes) {
      findings.push(...(await checkSafely(ruleSet, { ...root, deadline })));
    }

    sections.push({ heading: ruleSet.heading, findings });
  }

  // 2. Separate the rule sets that threw and the files a rule set never started from the findings, and keep the sections that hold findings.
  const all = sections.flatMap(section => section.findings);
  const report: Report = {
    sections: sections
      .map(({ heading, findings }) => ({
        heading,
        findings: findings.filter(finding => !isNote(finding)),
      }))
      .filter(section => section.findings.length > 0),
    failures: [
      ...new Set(
        all
          .filter(finding => finding.rule === FAILED)
          .map(finding => finding.message),
      ),
    ],
    unchecked: [
      ...new Set(
        all
          .filter(finding => finding.rule === UNCHECKED)
          .map(finding => finding.file),
      ),
    ],
    skipped,
  };

  if (
    report.sections.length === 0 &&
    report.failures.length === 0 &&
    report.unchecked.length === 0 &&
    report.skipped.length === 0
  ) {
    return;
  }

  // 3. Block with the reason, which names what could not run and what was left unchecked last.
  blockStop(reasonOf(cwd, report));
}

/** Reads the time a stop may spend on its checks from the environment, which a test sets to run into the deadline. An empty setting keeps the default. */
function readBudgetMs(): number {
  const setting = process.env.FORGE_CHECK_BUDGET_MS?.trim();
  const budget = Number(setting);

  return setting === undefined || setting === '' || Number.isNaN(budget)
    ? DEFAULT_BUDGET_MS
    : budget;
}

/** Tells whether the finding only stands for a rule set that threw or a file it never started, which the reason words on its own. */
function isNote(finding: Finding): boolean {
  return finding.rule === FAILED || finding.rule === UNCHECKED;
}

/** Writes the intro, then each section as its heading with a colon and one line per finding, sections apart by a blank line, then the rule sets that could not run and the note on what was not checked in time. */
function reasonOf(
  cwd: string,
  { sections, failures, unchecked, skipped }: Report,
): string {
  const blocks = sections.map(({ heading, findings }) => [
    `${heading}:`,
    ...findings.map(finding => lineOf(cwd, finding)),
  ]);

  if (failures.length > 0) {
    blocks.push(failures);
  }

  const late = [
    unchecked.length > 0
      ? `${quantityOf(unchecked.length, 'file')}, starting with ${displayPathOf(cwd, unchecked[0])}`
      : null,
    skipped.length > 0
      ? `${quantityOf(skipped.length, 'checkout')}, starting with ${skipped[0]}`
      : null,
  ].filter(part => part !== null);

  if (late.length > 0) {
    blocks.push([`Not checked in time: ${late.join(', and ')}.`]);
  }

  return [INTRO, ...blocks.map(block => ['', ...block].join('\n'))].join('\n');
}

/** Writes the number with its noun, in the plural unless it is one. */
function quantityOf(number: number, noun: string): string {
  return `${number} ${noun}${number === 1 ? '' : 's'}`;
}

/** Writes one finding as path:line rule message, the format the skills name. */
function lineOf(cwd: string, finding: Finding): string {
  return `${displayPathOf(cwd, finding.file)}:${finding.line} ${finding.rule} ${finding.message}`;
}

/** Shows a path below the working directory relative with slashes, and any other path absolute, so a sibling worktree stays unambiguous. */
function displayPathOf(cwd: string, file: string): string {
  return segmentsBelow(cwd, file)?.join('/') ?? file;
}

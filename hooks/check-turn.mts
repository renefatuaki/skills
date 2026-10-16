#!/usr/bin/env node

// Notes when a turn starts and which files its Edits and Writes are about to touch, then blocks the end of the turn once when a file it changed breaks a rule.
// https://code.claude.com/docs/en/hooks.md

import {
  agentChanges,
  type Changes,
  noteEdit,
  noteTurnStart,
  turnChanges,
} from './lib/changes.mts';
import { comments } from './lib/comments.mts';
import { diagramSyntax, linkedDiagrams } from './lib/diagrams.mts';
import { docs } from './lib/docs.mts';
import {
  blockStop,
  type Finding,
  parseTurnEvent,
  readHookInput,
  type RuleSet,
  segmentsBelow,
  UNCHECKED,
} from './lib/hook.mts';

/** The findings of one rule set across every checkout, in the order of the checkouts and then of the files. */
type Section = {
  heading: string;
  findings: Finding[];
};

/** Every rule set in the order its section stands in the reason. The one list a new rule set joins. */
const RULE_SETS: RuleSet[] = [comments, docs, diagramSyntax, linkedDiagrams];

/** Opens the reason, which Claude reads as its instruction for the rest of the turn. */
const INTRO =
  'The forge Stop hook checked every file this turn changed. Fix each line below, then end the turn.';

/** The time a stop gets to check files, which leaves the rest of the 30 seconds the host allows to print the reason. */
const DEFAULT_BUDGET_MS = 25_000;

const startedAt = Date.now();

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
        await blockOnFindings(event.cwd, turnChanges(event.session, event.cwd));
      }

      break;
    case 'subagent-stop':
      if (!event.continuing) {
        await blockOnFindings(
          event.cwd,
          agentChanges(event.session, event.cwd, event.agent),
        );
      }

      break;

    default: {
      const unhandled: never = event;

      throw new Error(`unhandled turn event ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Runs every rule set over every checkout and blocks the stop with all findings, silent when there is none. */
async function blockOnFindings(
  cwd: string,
  checkouts: Changes[],
): Promise<void> {
  // 1. Give every checkout the deadline, and run each rule set over all of them. Each rule set builds its linter or parser once per checkout.
  const deadline = startedAt + budgetMs();
  const sections: Section[] = [];

  for (const ruleSet of RULE_SETS) {
    const findings: Finding[] = [];

    for (const checkout of checkouts) {
      findings.push(...(await ruleSet.check({ ...checkout, deadline })));
    }

    sections.push({ heading: ruleSet.heading, findings });
  }

  // 2. Separate the files a rule set never started from the findings, and keep the sections that hold findings.
  const unchecked = [
    ...new Set(
      sections.flatMap(section =>
        section.findings.filter(isUnchecked).map(finding => finding.file),
      ),
    ),
  ];

  const reported = sections
    .map(({ heading, findings }) => ({
      heading,
      findings: findings.filter(finding => !isUnchecked(finding)),
    }))
    .filter(section => section.findings.length > 0);

  if (reported.length === 0 && unchecked.length === 0) {
    return;
  }

  // 3. Block with the reason, which names the files left unchecked last.
  blockStop(reasonOf(cwd, reported, unchecked));
}

/** Reads the time a stop may spend on its checks from the environment, which a test sets to run into the deadline. */
function budgetMs(): number {
  const budget = Number(process.env.FORGE_CHECK_BUDGET_MS);

  return process.env.FORGE_CHECK_BUDGET_MS === undefined || Number.isNaN(budget)
    ? DEFAULT_BUDGET_MS
    : budget;
}

/** Tells whether the finding only stands for a file the deadline kept a rule set from starting. */
function isUnchecked(finding: Finding): boolean {
  return finding.rule === UNCHECKED;
}

/** Writes the intro, then each section as its heading with a colon and one line per finding, sections apart by a blank line, and the note on unchecked files last. */
function reasonOf(
  cwd: string,
  sections: Section[],
  unchecked: string[],
): string {
  const blocks = sections.map(({ heading, findings }) => [
    `${heading}:`,
    ...findings.map(finding => lineOf(cwd, finding)),
  ]);

  if (unchecked.length > 0) {
    const noun = unchecked.length === 1 ? 'file' : 'files';

    blocks.push([
      `Not checked in time: ${unchecked.length} ${noun}, starting with ${shown(cwd, unchecked[0])}.`,
    ]);
  }

  return [INTRO, ...blocks.map(block => ['', ...block].join('\n'))].join('\n');
}

/** Writes one finding as path:line rule message, the format the skills name. */
function lineOf(cwd: string, finding: Finding): string {
  return `${shown(cwd, finding.file)}:${finding.line} ${finding.rule} ${finding.message}`;
}

/** Shows a path below the working directory relative with slashes, and any other path absolute, so a sibling worktree stays unambiguous. */
function shown(cwd: string, file: string): string {
  return segmentsBelow(cwd, file)?.join('/') ?? file;
}

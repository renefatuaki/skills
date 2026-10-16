// The plumbing the hooks share, which reads the hook input from stdin and hands findings or context back to Claude.
// https://code.claude.com/docs/en/hooks.md

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { Changes } from './changes.mts';

/** What the PostToolUse hook receives on stdin, the fields the hooks read. */
type HookInput = {
  cwd?: string;
  tool_input?: {
    file_path?: unknown;
  };
};

/** The path an Edit or Write touched, resolved against the working directory of the session. */
export type EditedPath = {
  root: string;
  absolute: string;
};

/** The file an Edit or Write touched inside the project, with the segments of its path below the root. */
export type EditedFile = EditedPath & {
  segments: string[];
};

/** One rule violation in a changed file. The file is absolute, the rule is named as its skill names it. */
export type Finding = {
  file: string;
  line: number;
  rule: string;
  message: string;
};

/** One group of rules and the heading its findings stand under, checked over the changed files of one checkout at a time. */
export type RuleSet = {
  heading: string;
  check(changes: Changes): Promise<Finding[]>;
};

/** The rule of the finding that stands for a file a rule set never started, because the deadline had passed. */
export const UNCHECKED = 'unchecked';

/** Reads the hook input from stdin, an empty object when the input is no JSON object. */
export function readHookInput(): unknown {
  try {
    const input: unknown = JSON.parse(readFileSync(0, 'utf8'));

    return typeof input === 'object' && input !== null ? input : {};
  } catch {
    return {};
  }
}

/** Reads the hook input from stdin and returns the edited path, or null when the input is no JSON or names no file. */
export function readEditedPath(): EditedPath | null {
  const input = readHookInput() as HookInput;
  const filePath = input.tool_input?.file_path;

  if (typeof filePath !== 'string') {
    return null;
  }

  const root = input.cwd ?? process.cwd();

  return { root, absolute: resolve(root, filePath) };
}

/** Returns the edited file, or null when the input names none or names one outside the project. */
export function readEditedFile(): EditedFile | null {
  const edited = readEditedPath();

  if (edited === null) {
    return null;
  }

  const segments = segmentsBelow(edited.root, edited.absolute);

  return segments === null ? null : { ...edited, segments };
}

/** Tells whether the path runs through a dot folder or a dependency folder. */
export function isHidden(segments: string[]): boolean {
  return segments.some(
    segment => segment.startsWith('.') || segment === 'node_modules',
  );
}

/**
 * Hands the lines to Claude as additional context, which informs and never blocks the edit.
 * @see {@link https://code.claude.com/docs/en/hooks.md#posttooluse-decision-control | Claude Code, PostToolUse decision control}
 */
export function report(lines: string[]): void {
  addContext('PostToolUse', lines);
}

/**
 * Hands the lines to Claude as additional context of the event.
 * @see {@link https://code.claude.com/docs/en/hooks.md#sessionstart-decision-control | Claude Code, SessionStart decision control}
 */
export function addContext(
  event: 'PostToolUse' | 'SessionStart',
  lines: string[],
): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: event,
        additionalContext: lines.join('\n'),
      },
    }),
  );
}

/**
 * Resolves a package from the dependencies of the project, because the hook runs from the plugin folder, which has none.
 * @see {@link https://nodejs.org/api/module.md#modulecreaterequirefilename | Node.js, module.createRequire}
 */
export function resolveFromProject(
  root: string,
  specifier: string,
): string | null {
  const require = createRequire(join(root, 'package.json'));

  try {
    return require.resolve(specifier);
  } catch {
    return null;
  }
}

/** Checks the files one at a time and stops starting new ones once the deadline has passed. Each file it never started comes back as an unchecked finding. */
export async function checkEach(
  { deadline = Infinity }: Changes,
  files: string[],
  check: (file: string) => Promise<Finding[]>,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  for (const file of files) {
    if (Date.now() >= deadline) {
      findings.push({
        file,
        line: 1,
        rule: UNCHECKED,
        message: 'Not checked in time.',
      });

      continue;
    }

    findings.push(...(await check(file)));
  }

  return findings;
}

/** Returns the segments of the path below the root, or null for a file outside it, which on Windows may sit on another drive. */
export function segmentsBelow(root: string, absolute: string): string[] | null {
  const path = relative(root, absolute);

  return path.startsWith('..') || isAbsolute(path) ? null : path.split(sep);
}

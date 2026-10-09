// The plumbing the PostToolUse hooks share, which reads the edited file from stdin and hands findings back to Claude.
// https://code.claude.com/docs/en/hooks.md

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

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

/** Reads the hook input from stdin and returns the edited path, or null when the input is no JSON or names no file. */
export function readEditedPath(): EditedPath | null {
  let input: HookInput;

  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return null;
  }

  const filePath = input?.tool_input?.file_path;

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
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
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

/** Returns the segments of the path below the root, or null for a file outside it, which on Windows may sit on another drive. */
function segmentsBelow(root: string, absolute: string): string[] | null {
  const path = relative(root, absolute);

  return path.startsWith('..') || isAbsolute(path) ? null : path.split(sep);
}

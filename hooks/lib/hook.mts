// The plumbing the hooks share, which reads the hook input from stdin and hands context or a blocked stop back to Claude.
// https://code.claude.com/docs/en/hooks.md

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { Changes } from './changes.mts';

/** A session id that is safe as a file name. Only asSessionId makes one, so the path of a journal can never leave its folder. */
export type SessionId = string & { readonly __sessionId: true };

/** What one hook event asks of the turn hook, parsed from the input of UserPromptSubmit, PreToolUse, Stop or SubagentStop. */
export type TurnEvent =
  | { kind: 'prompt'; session: SessionId; cwd: string }
  | { kind: 'edit'; session: SessionId; agent: string | null; path: string }
  | { kind: 'stop'; session: SessionId; cwd: string; continuing: boolean }
  | {
      kind: 'subagent-stop';
      session: SessionId;
      agent: string;
      cwd: string;
      continuing: boolean;
    };

/** The fields of the turn events the turn hook reads, none of them trusted yet. */
type TurnInput = {
  hook_event_name?: unknown;
  session_id?: unknown;
  agent_id?: unknown;
  cwd?: unknown;
  stop_hook_active?: unknown;
  tool_input?: {
    file_path?: unknown;
  };
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

/** Parses the input of the four events the turn hook handles, null for any other input and for an id that is unsafe as a file name. */
export function parseTurnEvent(input: unknown): TurnEvent | null {
  // 1. Read the fields of the event, the working directory falling back to the one of the process.
  const fields = input as TurnInput;
  const session = asSessionId(fields.session_id);
  const cwd = typeof fields.cwd === 'string' ? fields.cwd : process.cwd();

  // 2. Accept the id of a subagent only when it is safe as a file name. Only a hook that fires inside a subagent carries one.
  const agent =
    fields.agent_id === undefined ? null : asSafeId(fields.agent_id);

  if (session === null || (fields.agent_id !== undefined && agent === null)) {
    return null;
  }

  // 3. Turn the event into its kind. A tool event needs the file it is about to touch.
  // https://code.claude.com/docs/en/hooks.md
  const continuing = fields.stop_hook_active === true;
  const filePath = fields.tool_input?.file_path;

  switch (fields.hook_event_name) {
    case 'UserPromptSubmit':
      return { kind: 'prompt', session, cwd };
    case 'PreToolUse':
      return typeof filePath === 'string'
        ? { kind: 'edit', session, agent, path: resolve(cwd, filePath) }
        : null;
    case 'Stop':
      return { kind: 'stop', session, cwd, continuing };
    case 'SubagentStop':
      return agent === null
        ? null
        : { kind: 'subagent-stop', session, agent, cwd, continuing };
    default:
      return null;
  }
}

/** Tells whether the path runs through a dot folder or a dependency folder. */
export function isHidden(segments: string[]): boolean {
  return segments.some(
    segment => segment.startsWith('.') || segment === 'node_modules',
  );
}

/**
 * Blocks the stop of the turn or of the subagent, which then continues with the reason as its instruction.
 * @see {@link https://code.claude.com/docs/en/hooks.md#stop-decision-control | Claude Code, Stop decision control}
 */
export function blockStop(reason: string): void {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

/**
 * Hands the lines to Claude as additional context of the session start.
 * @see {@link https://code.claude.com/docs/en/hooks.md#sessionstart-decision-control | Claude Code, SessionStart decision control}
 */
export function addContext(event: 'SessionStart', lines: string[]): void {
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

/** Returns the id when it is a string that is safe as a file name, otherwise null. */
function asSafeId(value: unknown): string | null {
  return typeof value === 'string' && /^[\w-]+$/.test(value) ? value : null;
}

/** Brands the value as a session id when it is safe as a file name, otherwise null. */
function asSessionId(value: unknown): SessionId | null {
  return asSafeId(value) as SessionId | null;
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

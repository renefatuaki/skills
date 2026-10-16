// The plumbing the hooks share, which reads the hook input from stdin and hands context, a denied edit or a blocked stop back to Claude.
// https://code.claude.com/docs/en/hooks.md

import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

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

/** What a tool hook receives on stdin, the fields the hooks read. A subagent adds its agent_id. */
export type HookInput = {
  cwd?: string;
  session_id?: unknown;
  transcript_path?: unknown;
  agent_id?: unknown;
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

/** The rule of the finding that stands for a rule set that threw. Its message names the rule set and the reason. */
export const FAILED = 'failed';

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
  const cwd = realPathOf(
    typeof fields.cwd === 'string' ? fields.cwd : process.cwd(),
  );

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
        ? { kind: 'edit', session, agent, path: realFileOf(cwd, filePath) }
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

/**
 * Resolves the symbolic links of the path as far as it exists and keeps the rest as it is, so one checkout reached through /tmp and through /private/tmp is one path.
 * @see {@link https://nodejs.org/api/fs.md#fsrealpathsyncpath-options | Node.js, fs.realpathSync}
 */
export function realPathOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);

    return parent === path ? path : join(realPathOf(parent), basename(path));
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
 * Denies the tool call and hands Claude the reason, which it reads before it repeats the call.
 * @see {@link https://code.claude.com/docs/en/hooks.md#pretooluse-decision-control | Claude Code, PreToolUse decision control}
 */
export function deny(reason: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
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

/** Runs a rule set over one checkout. An error it throws costs only its own findings and comes back as the one finding that names the rule set and the reason. */
export async function checkSafely(
  ruleSet: RuleSet,
  changes: Changes,
): Promise<Finding[]> {
  try {
    return await ruleSet.check(changes);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return [
      {
        file: changes.root,
        line: 1,
        rule: FAILED,
        message: `${ruleSet.heading} could not run: ${reason.replace(/\s+/g, ' ')}`,
      },
    ];
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

/** Brands the value as a session id when it is safe as a file name, otherwise null. */
function asSessionId(value: unknown): SessionId | null {
  return asSafeId(value) as SessionId | null;
}

/** Returns the id when it is a string that is safe as a file name, otherwise null. */
function asSafeId(value: unknown): string | null {
  return typeof value === 'string' && /^[\w-]+$/.test(value) ? value : null;
}

/** Returns the absolute path of the file the tool is about to write, the symbolic links of its folder resolved. A link as the file itself stays one, because the tool then writes through it. */
function realFileOf(cwd: string, file: string): string {
  const absolute = resolve(cwd, file);

  return join(realPathOf(dirname(absolute)), basename(absolute));
}

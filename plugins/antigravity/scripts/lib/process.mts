// Ported from scripts/lib/process.mjs of the OpenAI Codex plugin for Claude Code 1.0.6 (Apache-2.0 License, Copyright 2026 OpenAI).

import { spawnSync } from 'node:child_process';

import type { BinaryStatus } from './types.mts';

/** The options of a command that the helpers pass on to spawnSync. */
export type CommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  maxBuffer?: number;
  timeout?: number;
  shell?: boolean | string;
};

/** What a finished command left, with an empty string for a stream it did not fill. */
export type CommandResult = {
  command: string;
  args: string[];
  status: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error: NodeJS.ErrnoException | null;
};

/** What terminating a process tree did. */
export type TerminationResult = {
  attempted: boolean;
  delivered: boolean;
  method: string | null;
};

/** Runs a command to the end and returns its streams, its status and a spawn error when there was one. */
export function runCommand(
  command: string,
  args: string[] = [],
  options: CommandOptions = {},
): CommandResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    input: options.input,
    maxBuffer: options.maxBuffer,
    timeout: options.timeout,
    stdio: 'pipe',
    shell:
      options.shell ??
      (process.platform === 'win32' ? process.env.SHELL || true : false),
    windowsHide: true,
  });

  return {
    command,
    args,
    status: result.status ?? 0,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ?? null,
  };
}

/** Runs a command and throws on a spawn error or a status other than 0. */
export function runCommandChecked(
  command: string,
  args: string[] = [],
  options: CommandOptions = {},
): CommandResult {
  const result = runCommand(command, args, options);

  if (result.error !== null) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result));
  }

  return result;
}

/** Runs the version command of a binary and reports whether it answers. */
export function binaryAvailable(
  command: string,
  versionArgs: string[] = ['--version'],
  options: CommandOptions = {},
): BinaryStatus {
  const result = runCommand(command, versionArgs, options);

  if (result.error?.code === 'ENOENT') {
    return { available: false, detail: 'not found' };
  }

  if (result.error !== null) {
    return { available: false, detail: result.error.message };
  }

  if (result.status !== 0) {
    const detail =
      result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;

    return { available: false, detail };
  }

  return {
    available: true,
    detail: result.stdout.trim() || result.stderr.trim() || 'ok',
  };
}

/** Delivers a signal to a process group, and to the single process when the pid leads no group. */
function sendSignal(
  pid: number,
  signal: NodeJS.Signals,
  killImpl: (pid: number, signal: NodeJS.Signals) => true,
): TerminationResult {
  try {
    killImpl(-pid, signal);

    return { attempted: true, delivered: true, method: 'process-group' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      throw error;
    }
  }

  try {
    killImpl(pid, signal);

    return { attempted: true, delivered: true, method: 'process' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return { attempted: true, delivered: false, method: 'process' };
    }

    throw error;
  }
}

/** Terminates a process and the children in its group, or on Windows the whole tree through taskkill. */
export function terminateProcessTree(
  pid: number,
  options: { platform?: NodeJS.Platform; killImpl?: typeof process.kill } = {},
): TerminationResult {
  if (!Number.isFinite(pid)) {
    return { attempted: false, delivered: false, method: null };
  }

  const platform = options.platform ?? process.platform;
  const killImpl = options.killImpl ?? process.kill.bind(process);

  if (platform === 'win32') {
    const result = runCommand('taskkill', ['/PID', String(pid), '/T', '/F']);

    if (result.error === null && result.status === 0) {
      return { attempted: true, delivered: true, method: 'taskkill' };
    }

    return { attempted: true, delivered: false, method: 'taskkill' };
  }

  return sendSignal(pid, 'SIGTERM', killImpl);
}

/** Describes a failed command in one line, with the signal or the status and the first stream that holds text. */
export function formatCommandFailure(result: CommandResult): string {
  const parts = [`${result.command} ${result.args.join(' ')}`.trim()];

  parts.push(
    result.signal === null
      ? `exit=${result.status}`
      : `signal=${result.signal}`,
  );

  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();

  if (stderr !== '') {
    parts.push(stderr);
  } else if (stdout !== '') {
    parts.push(stdout);
  }

  return parts.join(': ');
}

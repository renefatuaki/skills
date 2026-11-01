// Ported from scripts/lib/git.mjs of the OpenAI Codex plugin for Claude Code 1.0.6 (Apache-2.0 License, Copyright 2026 OpenAI).

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { isProbablyText } from './fs.mts';
import {
  formatCommandFailure,
  runCommand,
  runCommandChecked,
} from './process.mts';
import type { CommandOptions, CommandResult } from './process.mts';

const MAX_UNTRACKED_BYTES = 24 * 1024;

/** Stays below the 128 KiB a single argument may hold on Linux, because the prompt travels as the argument of `agy -p`. */
const DEFAULT_INLINE_DIFF_MAX_BYTES = 100 * 1024;

/** What a review looks at, the working tree or the branch against a base. */
export type ReviewTarget = {
  mode: 'working-tree' | 'branch';
  label: string;
  baseRef?: string;
  explicit: boolean;
};

/** The paths of the working tree, grouped by how Git sees them. */
export type WorkingTreeState = {
  staged: string[];
  unstaged: string[];
  untracked: string[];
  isDirty: boolean;
};

type BranchComparison = {
  mergeBase: string;
  commitRange: string;
  reviewRange: string;
};

/** The text of the review prompt, with how much of the diff it holds. */
export type ReviewContext = {
  cwd: string;
  repoRoot: string;
  branch: string;
  target: ReviewTarget;
  mode: 'working-tree' | 'branch';
  summary: string;
  content: string;
  changedFiles: string[];
  fileCount: number;
  diffBytes: number;
  inputMode: 'inline-diff' | 'self-collect';
  collectionGuidance: string;
};

// Git is directly executable on Windows. Repository-derived arguments must never pass through a shell.
function git(
  cwd: string,
  args: string[],
  options: CommandOptions = {},
): CommandResult {
  return runCommand('git', args, { cwd, ...options, shell: false });
}

function gitChecked(
  cwd: string,
  args: string[],
  options: CommandOptions = {},
): CommandResult {
  return runCommandChecked('git', args, { cwd, ...options, shell: false });
}

function listUniqueFiles(...groups: string[][]): string[] {
  return [...new Set(groups.flat().filter(Boolean))].sort();
}

function splitLines(text: string): string[] {
  return text.trim().split('\n').filter(Boolean);
}

function normalizeMaxInlineDiffBytes(value: unknown): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_INLINE_DIFF_MAX_BYTES;
  }

  return Math.floor(parsed);
}

function measureGitOutputBytes(
  cwd: string,
  args: string[],
  maxBytes: number,
): number {
  const result = git(cwd, args, { maxBuffer: maxBytes + 1 });

  if (result.error?.code === 'ENOBUFS') {
    return maxBytes + 1;
  }

  if (result.error !== null) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result));
  }

  return Buffer.byteLength(result.stdout, 'utf8');
}

function measureCombinedGitOutputBytes(
  cwd: string,
  argSets: string[][],
  maxBytes: number,
): number {
  let totalBytes = 0;

  for (const args of argSets) {
    const remainingBytes = maxBytes - totalBytes;

    if (remainingBytes < 0) {
      return maxBytes + 1;
    }

    totalBytes += measureGitOutputBytes(cwd, args, remainingBytes);

    if (totalBytes > maxBytes) {
      return totalBytes;
    }
  }

  return totalBytes;
}

function buildBranchComparison(cwd: string, baseRef: string): BranchComparison {
  const mergeBase = gitChecked(cwd, [
    'merge-base',
    'HEAD',
    baseRef,
  ]).stdout.trim();

  return {
    mergeBase,
    commitRange: `${mergeBase}..HEAD`,
    reviewRange: `${baseRef}...HEAD`,
  };
}

/** Returns the root of the work tree of the folder, and throws outside a work tree. */
export function ensureGitRepository(cwd: string): string {
  const result = git(cwd, ['rev-parse', '--show-toplevel']);

  if (result.error?.code === 'ENOENT') {
    throw new Error('git is not installed. Install Git and retry.');
  }

  if (result.status !== 0 || result.error !== null) {
    throw new Error('This command must run inside a Git repository.');
  }

  return result.stdout.trim();
}

function getRepoRoot(cwd: string): string {
  return gitChecked(cwd, ['rev-parse', '--show-toplevel']).stdout.trim();
}

function detectDefaultBranch(cwd: string): string {
  const symbolic = git(cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD']);

  if (symbolic.status === 0) {
    const remoteHead = symbolic.stdout.trim();

    if (remoteHead.startsWith('refs/remotes/origin/')) {
      return remoteHead.replace('refs/remotes/origin/', '');
    }
  }

  for (const candidate of ['main', 'master', 'trunk']) {
    const local = git(cwd, [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${candidate}`,
    ]);

    if (local.status === 0) {
      return candidate;
    }

    const remote = git(cwd, [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/remotes/origin/${candidate}`,
    ]);

    if (remote.status === 0) {
      return `origin/${candidate}`;
    }
  }

  throw new Error(
    'Unable to detect the repository default branch. Pass --base <ref> or use --scope working-tree.',
  );
}

function getCurrentBranch(cwd: string): string {
  return gitChecked(cwd, ['branch', '--show-current']).stdout.trim() || 'HEAD';
}

function getWorkingTreeState(cwd: string): WorkingTreeState {
  const staged = splitLines(
    gitChecked(cwd, ['diff', '--cached', '--name-only']).stdout,
  );

  const unstaged = splitLines(gitChecked(cwd, ['diff', '--name-only']).stdout);

  const untracked = splitLines(
    gitChecked(cwd, ['ls-files', '--others', '--exclude-standard']).stdout,
  );

  return {
    staged,
    unstaged,
    untracked,
    isDirty: staged.length > 0 || unstaged.length > 0 || untracked.length > 0,
  };
}

/** Picks the working tree or a branch comparison from --base and --scope, the working tree when it has changes. */
export function resolveReviewTarget(
  cwd: string,
  options: { base?: string; scope?: string } = {},
): ReviewTarget {
  ensureGitRepository(cwd);

  const requestedScope = options.scope ?? 'auto';
  const baseRef = options.base ?? null;
  const state = getWorkingTreeState(cwd);
  const supportedScopes = new Set(['auto', 'working-tree', 'branch']);

  if (baseRef) {
    return {
      mode: 'branch',
      label: `branch diff against ${baseRef}`,
      baseRef,
      explicit: true,
    };
  }

  if (requestedScope === 'working-tree') {
    return { mode: 'working-tree', label: 'working tree diff', explicit: true };
  }

  if (!supportedScopes.has(requestedScope)) {
    throw new Error(
      `Unsupported review scope "${requestedScope}". Use one of: auto, working-tree, branch, or pass --base <ref>.`,
    );
  }

  if (requestedScope === 'branch') {
    const detectedBase = detectDefaultBranch(cwd);

    return {
      mode: 'branch',
      label: `branch diff against ${detectedBase}`,
      baseRef: detectedBase,
      explicit: true,
    };
  }

  if (state.isDirty) {
    return {
      mode: 'working-tree',
      label: 'working tree diff',
      explicit: false,
    };
  }

  const detectedBase = detectDefaultBranch(cwd);

  return {
    mode: 'branch',
    label: `branch diff against ${detectedBase}`,
    baseRef: detectedBase,
    explicit: false,
  };
}

function formatSection(title: string, body: string): string {
  return [`## ${title}`, '', body.trim() ? body.trim() : '(none)', ''].join(
    '\n',
  );
}

function formatUntrackedFile(cwd: string, relativePath: string): string {
  const absolutePath = join(cwd, relativePath);
  let stat;

  try {
    stat = statSync(absolutePath);
  } catch {
    return `### ${relativePath}\n(skipped: broken symlink or unreadable file)`;
  }

  if (stat.isDirectory()) {
    return `### ${relativePath}\n(skipped: directory)`;
  }

  if (stat.size > MAX_UNTRACKED_BYTES) {
    return `### ${relativePath}\n(skipped: ${stat.size} bytes exceeds ${MAX_UNTRACKED_BYTES} byte limit)`;
  }

  let buffer;

  try {
    buffer = readFileSync(absolutePath);
  } catch {
    return `### ${relativePath}\n(skipped: broken symlink or unreadable file)`;
  }

  if (!isProbablyText(buffer)) {
    return `### ${relativePath}\n(skipped: binary file)`;
  }

  return [
    `### ${relativePath}`,
    '```',
    buffer.toString('utf8').trimEnd(),
    '```',
  ].join('\n');
}

type Details = {
  mode: 'working-tree' | 'branch';
  summary: string;
  content: string;
  changedFiles: string[];
};

function collectWorkingTreeContext(
  cwd: string,
  state: WorkingTreeState,
  includeDiff: boolean,
): Details {
  const status = gitChecked(cwd, [
    'status',
    '--short',
    '--untracked-files=all',
  ]).stdout.trim();

  const changedFiles = listUniqueFiles(
    state.staged,
    state.unstaged,
    state.untracked,
  );

  const untrackedBody = state.untracked
    .map(file => formatUntrackedFile(cwd, file))
    .join('\n\n');

  let parts: string[];

  if (includeDiff) {
    const diffArgs = ['--binary', '--no-ext-diff', '--submodule=diff'];

    const stagedDiff = gitChecked(cwd, [
      'diff',
      '--cached',
      ...diffArgs,
    ]).stdout;

    const unstagedDiff = gitChecked(cwd, ['diff', ...diffArgs]).stdout;

    parts = [
      formatSection('Git Status', status),
      formatSection('Staged Diff', stagedDiff),
      formatSection('Unstaged Diff', unstagedDiff),
      formatSection('Untracked Files', untrackedBody),
    ];
  } else {
    const stagedStat = gitChecked(cwd, [
      'diff',
      '--shortstat',
      '--cached',
    ]).stdout.trim();

    const unstagedStat = gitChecked(cwd, ['diff', '--shortstat']).stdout.trim();

    parts = [
      formatSection('Git Status', status),
      formatSection('Staged Diff Stat', stagedStat),
      formatSection('Unstaged Diff Stat', unstagedStat),
      formatSection('Changed Files', changedFiles.join('\n')),
      formatSection('Untracked Files', untrackedBody),
    ];
  }

  return {
    mode: 'working-tree',
    summary: `Reviewing ${state.staged.length} staged, ${state.unstaged.length} unstaged, and ${state.untracked.length} untracked file(s).`,
    content: parts.join('\n'),
    changedFiles,
  };
}

function collectBranchContext(
  cwd: string,
  baseRef: string,
  includeDiff: boolean,
  comparison: BranchComparison,
): Details {
  const currentBranch = getCurrentBranch(cwd);

  const changedFiles = splitLines(
    gitChecked(cwd, ['diff', '--name-only', comparison.commitRange]).stdout,
  );

  const logOutput = gitChecked(cwd, [
    'log',
    '--oneline',
    '--decorate',
    comparison.commitRange,
  ]).stdout.trim();

  const diffStat = gitChecked(cwd, [
    'diff',
    '--stat',
    comparison.commitRange,
  ]).stdout.trim();

  const closing = includeDiff
    ? formatSection(
        'Branch Diff',
        gitChecked(cwd, [
          'diff',
          '--binary',
          '--no-ext-diff',
          '--submodule=diff',
          comparison.commitRange,
        ]).stdout,
      )
    : formatSection('Changed Files', changedFiles.join('\n'));

  return {
    mode: 'branch',
    summary: `Reviewing branch ${currentBranch} against ${baseRef} from merge-base ${comparison.mergeBase}.`,
    content: [
      formatSection('Commit Log', logOutput),
      formatSection('Diff Stat', diffStat),
      closing,
    ].join('\n'),
    changedFiles,
  };
}

/** Antigravity runs a review without shell access, so the guidance tells it to work from the text and the files and not to run git. */
function buildCollectionGuidance(includeDiff: boolean): string {
  const noShell =
    'This run is read-only and has no shell access, so do not try to run git or any other command.';

  if (includeDiff) {
    return `Use the repository context below as primary evidence. ${noShell}`;
  }

  return `The repository context below is a lightweight summary because the full diff is too large to inline. ${noShell} Read the changed files with your file tools and judge the changes from their content before finalizing findings.`;
}

/** Collects the git context of the target into the text a review prompt embeds, with the diff inline when it stays under the size limit. */
export function collectReviewContext(
  cwd: string,
  target: ReviewTarget,
  options: { includeDiff?: boolean; maxInlineDiffBytes?: number } = {},
): ReviewContext {
  const repoRoot = getRepoRoot(cwd);
  const currentBranch = getCurrentBranch(repoRoot);
  const maxInlineDiffBytes = normalizeMaxInlineDiffBytes(
    options.maxInlineDiffBytes,
  );

  let details: Details;
  let includeDiff: boolean;
  let diffBytes: number;

  if (target.mode === 'working-tree') {
    const state = getWorkingTreeState(repoRoot);

    diffBytes = measureCombinedGitOutputBytes(
      repoRoot,
      [
        ['diff', '--cached', '--binary', '--no-ext-diff', '--submodule=diff'],
        ['diff', '--binary', '--no-ext-diff', '--submodule=diff'],
      ],
      maxInlineDiffBytes,
    );

    includeDiff = options.includeDiff ?? diffBytes <= maxInlineDiffBytes;
    details = collectWorkingTreeContext(repoRoot, state, includeDiff);
  } else {
    const baseRef = target.baseRef ?? '';
    const comparison = buildBranchComparison(repoRoot, baseRef);

    diffBytes = measureGitOutputBytes(
      repoRoot,
      [
        'diff',
        '--binary',
        '--no-ext-diff',
        '--submodule=diff',
        comparison.commitRange,
      ],
      maxInlineDiffBytes,
    );

    includeDiff = options.includeDiff ?? diffBytes <= maxInlineDiffBytes;
    details = collectBranchContext(repoRoot, baseRef, includeDiff, comparison);
  }

  return {
    cwd: repoRoot,
    repoRoot,
    branch: currentBranch,
    target,
    fileCount: details.changedFiles.length,
    diffBytes,
    inputMode: includeDiff ? 'inline-diff' : 'self-collect',
    collectionGuidance: buildCollectionGuidance(includeDiff),
    ...details,
  };
}

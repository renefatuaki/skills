// Finds the files a turn changed, however they changed, in every checkout the turn worked in, from a journal of the turn and from git.
// https://git-scm.com/docs/git-status#_porcelain_format_version_1

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { type SessionId, segmentsBelow } from './hook.mts';

/** The files one turn changed below one root, absolute, sorted and unique, deleted files included. The root is a git top level, or the working directory for files outside any repository. */
export type Changes = {
  root: string;
  files: string[];
  /** The time in epoch milliseconds after which no new file is started, absent for no limit. */
  deadline?: number;
};

/** The git blob id of the content of a file, which is what git stores, or MISSING for a path that holds no file. */
type ContentId = string;

/** The one prompt line of the journal opens a turn. Its working directory is the first checkout the turn is known to work in. */
type PromptEntry = {
  at: number;
  agent: string | null;
  kind: 'prompt';
  cwd: string;
};

/** The state of one checkout when the turn first showed evidence of it. The dirty files are the paths git status names, relative to the root, with the content they held. */
type BaselineEntry = {
  at: number;
  agent: string | null;
  kind: 'baseline';
  root: string;
  head: string | null;
  dirty: Record<string, ContentId>;
};

/** The file an Edit or a Write is about to touch, with the content it holds before the tool runs. */
type EditEntry = {
  at: number;
  agent: string | null;
  kind: 'edit';
  path: string;
  before: ContentId;
};

/**
 * One line of the append-only journal of a session. The journal is the single source of a turn, the agent is the id of the subagent that wrote the line or null for the main session.
 * @see {@link https://code.claude.com/docs/en/hooks.md | Claude Code, hooks reference}
 */
type Entry = PromptEntry | BaselineEntry | EditEntry;

/** The current turn as the journal tells it, derived on every read from the lines after the last prompt. */
type Turn = {
  baselines: BaselineEntry[];
  edits: EditEntry[];
};

/** What the turn knows about one path that may have changed, enough to decide it without touching disk or git. */
type Evidence = {
  path: string;
  before: ContentId | null;
  now: ContentId;
  committed: ContentId;
  authored: boolean;
};

/** The content id of a path that holds no file. */
const MISSING: ContentId = 'missing';

/** Matches the worktree Claude Code creates for a subagent with isolation and captures the agent id. Only that subagent writes there. */
const AGENT_WORKTREE = /[\\/]\.claude[\\/]worktrees[\\/]agent-([^\\/]+)$/;

/** Matches the reflog subject of a commit made in the checkout, as opposed to a checkout, reset, merge, pull or rebase, which bring in work that was already there. */
const OWN_COMMIT = /^commit\b/;

/** The number of paths one git call gets, which keeps the command line below the limit of the system. */
const PATHS_PER_CALL = 200;

/** A journal that no hook wrote to for this long belongs to a session that is over. */
const JOURNAL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** Starts a new turn of the session and notes the state of the checkout it starts in. Journals of long-gone sessions are deleted here. */
export function noteTurnStart(session: SessionId, cwd: string): void {
  pruneJournals();
  append(session, { at: Date.now(), agent: null, kind: 'prompt', cwd });

  const root = toplevelOf(cwd);

  if (root !== null) {
    append(session, baselineOf(root, null));
  }
}

/** Notes the content of a file an Edit or a Write is about to touch, and the state of its checkout when the turn has none for it yet. Runs before the tool, so the content is the old one. */
export function noteEdit(
  session: SessionId,
  agent: string | null,
  path: string,
): void {
  const turn = turnOf(readJournal(session));

  if (turn === null) {
    return;
  }

  const root = toplevelOf(path);

  if (
    root !== null &&
    !turn.baselines.some(baseline => baseline.root === root)
  ) {
    append(session, baselineOf(root, agent));
  }

  append(session, {
    at: Date.now(),
    agent,
    kind: 'edit',
    path,
    before: contentIdOf(path) ?? MISSING,
  });
}

/** Lists what the current turn of the main session changed per checkout, nothing before its first prompt. Agent worktrees are left to their subagents. */
export function turnChanges(session: SessionId, cwd: string): Changes[] {
  // 1. Derive the turn from the journal, an empty list when no prompt started one.
  const turn = turnOf(readJournal(session));

  if (turn === null) {
    return [];
  }

  // 2. Place each edit in its checkout. An edit outside every repository joins the checkout of the stop, where only the comment rules reach it.
  const stopRoot = toplevelOf(cwd) ?? cwd;
  const placed = turn.edits.map(edit => ({
    edit,
    root: toplevelOf(edit.path) ?? stopRoot,
  }));

  // 3. The checkouts are those the turn left evidence in and the one the stop stands in, each once.
  const roots = new Set([
    ...turn.baselines.map(baseline => baseline.root),
    ...placed.map(({ root }) => root),
    stopRoot,
  ]);

  // 4. List the changed files of each checkout, without the worktrees of subagents.
  return [...roots]
    .filter(root => !AGENT_WORKTREE.test(root))
    .flatMap(root => {
      const baseline = turn.baselines.find(entry => entry.root === root);
      const edits = placed.filter(entry => entry.root === root);
      const files = changedIn(
        root,
        baseline ?? null,
        edits.map(({ edit }) => edit),
      );

      return files.length > 0 ? [{ root, files }] : [];
    });
}

/** Lists what a subagent with isolation changed in its own worktree, nothing for a subagent that works in a checkout the main session owns. */
export function agentChanges(
  session: SessionId,
  cwd: string,
  agent: string,
): Changes[] {
  // 1. Find the worktree of the subagent, an empty list when it has none.
  const root = agentWorktreeOf(cwd, agent);

  if (root === null) {
    return [];
  }

  // 2. Everything in the worktree is the work of this subagent. Its baseline stands in the turn when the subagent started in it.
  const turn = turnOf(readJournal(session));
  const baseline = turn?.baselines.find(entry => entry.root === root);
  const edits = (turn?.edits ?? []).filter(
    edit => toplevelOf(edit.path) === root,
  );

  const files = changedIn(root, baseline ?? null, edits);

  return files.length > 0 ? [{ root, files }] : [];
}

/** Appends one entry. An append is a single write, so concurrent hooks of one session never interleave a line. */
function append(session: SessionId, entry: Entry): void {
  const path = journalOf(session);

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

/** The journal of the session in the temporary folder of the user, which the operating system clears. */
function journalOf(session: SessionId): string {
  return join(journalFolder(), `${session}.jsonl`);
}

/** The folder of all journals of the user. */
function journalFolder(): string {
  return join(tmpdir(), `forge-${process.getuid?.() ?? 'user'}`);
}

/** Deletes every journal that no hook wrote to for a week. A journal that cannot be deleted stays. */
function pruneJournals(): void {
  try {
    for (const name of readdirSync(journalFolder())) {
      const path = join(journalFolder(), name);

      if (Date.now() - statSync(path).mtimeMs > JOURNAL_LIFETIME_MS) {
        unlinkSync(path);
      }
    }
  } catch {
    // A missing folder holds no journal, and a journal that vanished is deleted already.
  }
}

/** Reads every well-formed entry, none for a missing journal. A torn last line from a crashed hook is skipped. */
function readJournal(session: SessionId): Entry[] {
  let text: string;

  try {
    text = readFileSync(journalOf(session), 'utf8');
  } catch {
    return [];
  }

  return text.split('\n').flatMap(line => {
    const entry = parseEntry(line);

    return entry === null ? [] : [entry];
  });
}

/** Parses one journal line into an entry, or null for a line that is no entry. */
function parseEntry(line: string): Entry | null {
  let value: unknown;

  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }

  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const fields = value as Record<string, unknown>;
  const { at, agent } = fields;

  if (typeof at !== 'number' || (agent !== null && typeof agent !== 'string')) {
    return null;
  }

  if (fields.kind === 'prompt' && typeof fields.cwd === 'string') {
    return { at, agent, kind: 'prompt', cwd: fields.cwd };
  }

  if (
    fields.kind === 'edit' &&
    typeof fields.path === 'string' &&
    typeof fields.before === 'string'
  ) {
    return {
      at,
      agent,
      kind: 'edit',
      path: fields.path,
      before: fields.before,
    };
  }

  if (
    fields.kind === 'baseline' &&
    typeof fields.root === 'string' &&
    (fields.head === null || typeof fields.head === 'string') &&
    typeof fields.dirty === 'object' &&
    fields.dirty !== null
  ) {
    const dirty = Object.entries(fields.dirty).flatMap(([path, id]) =>
      typeof id === 'string' ? [[path, id] as const] : [],
    );

    return {
      at,
      agent,
      kind: 'baseline',
      root: fields.root,
      head: fields.head,
      dirty: Object.fromEntries(dirty),
    };
  }

  return null;
}

/** Returns the turn the last prompt started, or null when the journal holds no prompt. The first baseline of a checkout is the one that counts. */
function turnOf(entries: Entry[]): Turn | null {
  const start = entries.findLastIndex(entry => entry.kind === 'prompt');

  if (start === -1) {
    return null;
  }

  const inTurn = entries.slice(start + 1);

  return {
    baselines: inTurn.filter(entry => entry.kind === 'baseline'),
    edits: inTurn.filter(entry => entry.kind === 'edit'),
  };
}

/** Returns the nearest folder at or above the path that holds a .git folder or file, which covers a main checkout, a linked worktree and a submodule. */
function toplevelOf(path: string): string | null {
  let folder = path;

  while (!existsSync(join(folder, '.git'))) {
    const parent = dirname(folder);

    if (parent === folder) {
      return null;
    }

    folder = parent;
  }

  return folder;
}

/**
 * Returns the worktree of the subagent among the worktrees of the repository that holds cwd, or null when the subagent has none.
 * @see {@link https://git-scm.com/docs/git-worktree#_list_output_format | git worktree, porcelain format}
 */
function agentWorktreeOf(cwd: string, agent: string): string | null {
  const listing = git(toplevelOf(cwd) ?? cwd, [
    'worktree',
    'list',
    '--porcelain',
    '-z',
  ]);

  const worktrees = (listing ?? '')
    .split('\0')
    .filter(field => field.startsWith('worktree '))
    .map(field => field.slice('worktree '.length));

  return (
    worktrees.find(path => AGENT_WORKTREE.exec(path)?.[1] === agent) ?? null
  );
}

/** Takes the state of the checkout: the commit HEAD names, null before the first commit, and the content of every file git status names. */
function baselineOf(root: string, agent: string | null): BaselineEntry {
  const dirty: Record<string, ContentId> = {};

  for (const path of statusPaths(root)) {
    const id = contentIdOf(join(root, path));

    if (id !== null) {
      dirty[path] = id;
    }
  }

  return {
    at: Date.now(),
    agent,
    kind: 'baseline',
    root,
    head: headOf(root),
    dirty,
  };
}

/** Lists the files of the checkout that differ from the content they held when the turn started, deleted files included. */
function changedIn(
  root: string,
  baseline: BaselineEntry | null,
  edits: EditEntry[],
): string[] {
  // 1. Gather every path that may have changed. A path with no content now is a directory, which holds no rule to check.
  const now = new Map(
    candidatesOf(root, baseline, edits).flatMap(path => {
      const id = contentIdOf(path);

      return id === null ? [] : [[path, id] as const];
    }),
  );

  // 2. Look up what each path held when the turn started and what the commit of HEAD holds, in two calls for all paths.
  const paths = [...now.keys()];
  const started = baseline?.head ? treeIds(root, baseline.head, paths) : null;
  const committed = treeIds(root, 'HEAD', paths);
  const dirty = baseline?.dirty ?? {};
  const firstEdits = new Map(
    edits.toReversed().map(edit => [edit.path, edit.before]),
  );

  const written = new Set([
    ...Object.keys(dirty).map(path => join(root, path)),
    ...firstEdits.keys(),
    ...committedPaths(root, baseline),
  ]);

  // 3. Decide each path from what was gathered, without touching disk or git again.
  const evidence = paths.map((path): Evidence => {
    const known = dirty[relativeTo(root, path)] ?? firstEdits.get(path);

    return {
      path,
      before:
        baseline === null
          ? (known ?? null)
          : (known ?? started?.get(path) ?? MISSING),
      now: now.get(path) ?? MISSING,
      committed: committed.get(path) ?? MISSING,
      authored: written.has(path),
    };
  });

  return changedPaths(evidence).sort();
}

/**
 * The changed set as a pure function of the evidence. A path changed when its content now differs from the content the turn started with, or when the start is unknown.
 * A path that equals the commit of HEAD and that no one wrote in the turn was brought in by git, a checkout or a pull for example, and is left out.
 */
function changedPaths(evidence: Evidence[]): string[] {
  return evidence
    .filter(({ before, now, committed, authored }) => {
      const differs = before === null || before !== now;
      const brought = now === committed && !authored;

      return differs && !brought;
    })
    .map(({ path }) => path);
}

/** Lists every path that may have changed, absolute, deleted ones included. */
function candidatesOf(
  root: string,
  baseline: BaselineEntry | null,
  edits: EditEntry[],
): string[] {
  const names = [
    ...(baseline === null ? [] : trackedSince(root, baseline.head)),
    ...statusPaths(root),
    ...Object.keys(baseline?.dirty ?? {}),
  ];

  return [
    ...new Set([
      ...names.map(name => join(root, name)),
      ...edits.map(e => e.path),
    ]),
  ];
}

/**
 * Lists every path git status names, staged, unstaged and untracked, a rename as its two sides, without a nested repository such as an agent worktree.
 * @see {@link https://git-scm.com/docs/git-status#_porcelain_format_version_1 | git status, porcelain format version 1}
 */
function statusPaths(root: string): string[] {
  const output = git(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--no-renames',
  ]);

  return (output ?? '')
    .split('\0')
    .filter(entry => entry.length > 3)
    .map(entry => entry.slice(3))
    .filter(path => !path.endsWith('/'));
}

/**
 * Lists the tracked files whose working tree content differs from the commit, or every tracked file when there was no commit yet. A commit, an amend or a reset made since then is part of the difference.
 * @see {@link https://git-scm.com/docs/git-diff#_raw_output_format | git diff, name-only output}
 */
function trackedSince(root: string, head: string | null): string[] {
  const output =
    head === null
      ? git(root, ['ls-files', '-z'])
      : git(root, ['diff', '--name-only', '-z', '--no-renames', head]);

  return (output ?? '').split('\0').filter(path => path !== '');
}

/** Lists the files of the commits the checkout made since the baseline, which tells a file the model committed from a file a checkout or a pull brought in. Nothing when HEAD did not move. */
function committedPaths(
  root: string,
  baseline: BaselineEntry | null,
): string[] {
  if (baseline === null || baseline.head === headOf(root)) {
    return [];
  }

  // 1. Read the reflog of HEAD, which prints HEAD@{<seconds>}, the commit and the subject per entry.
  // https://git-scm.com/docs/git-log#Documentation/git-log.txt--g
  const since = Math.floor(baseline.at / 1000);
  const reflog = git(root, [
    'log',
    '-g',
    '--format=%gd%x09%H%x09%gs',
    '--date=unix',
    'HEAD',
  ]);

  // 2. Keep the commits the checkout made since the baseline. A checkout, reset, merge, pull, cherry-pick and rebase entry is no commit of its own.
  const commits = (reflog ?? '').split('\n').flatMap(line => {
    const [selector, commit, subject] = line.split('\t');
    const seconds = Number(selector.match(/\{(\d+)\}/)?.[1]);

    return seconds >= since && OWN_COMMIT.test(subject ?? '') ? [commit] : [];
  });

  // 3. List the files of those commits in one call. With --cc a merge names only the files its resolution changed.
  // https://git-scm.com/docs/git-diff-tree
  const output = git(
    root,
    [
      'diff-tree',
      '--stdin',
      '--root',
      '-r',
      '--no-renames',
      '--cc',
      '--name-only',
      '-z',
      '--no-commit-id',
    ],
    commits.map(commit => `${commit}\n`).join(''),
  );

  return (output ?? '')
    .split('\0')
    .filter(path => path !== '')
    .map(path => join(root, path));
}

/**
 * Looks up the blob id of each path in a commit. A path the commit does not hold is not in the result.
 * @see {@link https://git-scm.com/docs/git-ls-tree | git ls-tree}
 */
function treeIds(
  root: string,
  commit: string,
  paths: string[],
): Map<string, ContentId> {
  const ids = new Map<string, ContentId>();
  const below = paths.filter(path => segmentsBelow(root, path) !== null);

  for (let start = 0; start < below.length; start += PATHS_PER_CALL) {
    const names = below
      .slice(start, start + PATHS_PER_CALL)
      .map(path => relativeTo(root, path));

    const output = git(root, ['ls-tree', '-r', '-z', commit, '--', ...names]);

    for (const entry of (output ?? '').split('\0')) {
      const tab = entry.indexOf('\t');
      const id = entry.slice(0, tab).split(' ')[2];

      if (tab !== -1) {
        ids.set(join(root, entry.slice(tab + 1)), id);
      }
    }
  }

  return ids;
}

/** Returns the commit HEAD names, or null in a checkout without a commit and outside a repository. */
function headOf(root: string): string | null {
  return git(root, ['rev-parse', 'HEAD'])?.trim() ?? null;
}

/** Returns the path below the root with slashes, as git names it. */
function relativeTo(root: string, path: string): string {
  return (segmentsBelow(root, path) ?? []).join('/');
}

/** Returns the git blob id of the content of the file, the target for a symbolic link, MISSING for a path without a file and null for a directory. */
function contentIdOf(path: string): ContentId | null {
  try {
    const stat = lstatSync(path);

    if (stat.isSymbolicLink()) {
      return blobId(Buffer.from(readlinkSync(path)));
    }

    return stat.isFile() ? blobId(readFileSync(path)) : null;
  } catch {
    return MISSING;
  }
}

/**
 * Hashes the bytes the way git hashes a blob, so the id of a file equals the id of the same content in a commit.
 * @see {@link https://git-scm.com/book/en/v2/Git-Internals-Git-Objects.md#_object_storage | Pro Git, object storage}
 */
function blobId(bytes: Buffer): ContentId {
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}

/** Runs git in the checkout without optional locks, so a stop never holds the index lock another session or the model needs, and with literal pathspecs. Null when git fails. */
function git(root: string, args: string[], input?: string): string | null {
  const result = spawnSync(
    'git',
    ['--no-optional-locks', '-C', root, ...args],
    {
      encoding: 'utf8',
      input,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_LITERAL_PATHSPECS: '1' },
    },
  );

  return result.status === 0 ? result.stdout : null;
}

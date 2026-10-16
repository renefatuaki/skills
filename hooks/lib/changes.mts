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
  promptAt: number;
  baselines: BaselineEntry[];
  edits: EditEntry[];
};

/** The content id of a path that holds no file. */
const MISSING: ContentId = 'missing';

/** The content id of a file git could not read, which equals no content. */
const UNREADABLE: ContentId = 'unreadable';

/** Matches the worktree Claude Code creates for a subagent with isolation and captures the agent id. Only that subagent writes there. */
const AGENT_WORKTREE = /[\\/]\.claude[\\/]worktrees[\\/]agent-([^\\/]+)$/;

/** The number of paths one git call gets, which keeps the command line below the limit of the system. */
const PATHS_PER_CALL = 200;

/** A journal that no hook wrote to for this long belongs to a session that is over. */
const JOURNAL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** Starts a new turn of the session and notes the state of the checkout it starts in. Journals of long-gone sessions are deleted here. */
export function noteTurnStart(session: SessionId, cwd: string): void {
  const at = Date.now();

  pruneJournals();
  append(session, { at, agent: null, kind: 'prompt', cwd });

  const root = toplevelOf(cwd);

  if (root !== null) {
    append(session, baselineOf(root, null, at));
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

  // 1. A checkout that did not exist when the turn started begins in the state it was created in. Every other checkout begins in the state it is in now. A subagent worktree needs neither, its state is the one it was created in.
  const root = toplevelOf(path);

  if (
    root !== null &&
    !AGENT_WORKTREE.test(root) &&
    !turn.baselines.some(baseline => baseline.root === root)
  ) {
    append(
      session,
      creationBaseline(root, agent, turn.promptAt) ??
        baselineOf(root, agent, Date.now()),
    );
  }

  // 2. The first Edit of a path holds the content that counts, a later one adds nothing.
  if (turn.edits.some(edit => edit.path === path)) {
    return;
  }

  append(session, {
    at: Date.now(),
    agent,
    kind: 'edit',
    path,
    before: contentIds(root ?? dirname(path), [path]).get(path) ?? MISSING,
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
      const edits = placed
        .filter(entry => entry.root === root)
        .map(({ edit }) => edit);

      const files = changedIn(root, baselineFor(root, turn), edits);

      return files.length > 0 ? [{ root, files }] : [];
    });
}

/** Lists what a subagent with isolation changed in its own worktree, nothing for a subagent that works in a checkout the main session owns. */
export function agentChanges(
  session: SessionId,
  cwd: string,
  agent: string,
): Changes[] {
  const turn = turnOf(readJournal(session));

  return agentWorktreesOf(cwd, agent, turn).flatMap(root => {
    const edits = (turn?.edits ?? []).filter(
      edit => toplevelOf(edit.path) === root,
    );

    const files = changedIn(root, baselineFor(root, turn), edits);

    return files.length > 0 ? [{ root, files }] : [];
  });
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
    promptAt: entries[start].at,
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
 * Lists the worktrees of the subagent: the one the worktrees of the repository that holds cwd name and the ones its Edits in the turn lie in. Empty when it has none.
 * @see {@link https://git-scm.com/docs/git-worktree#_list_output_format | git worktree, porcelain format}
 */
function agentWorktreesOf(
  cwd: string,
  agent: string,
  turn: Turn | null,
): string[] {
  const listing = git(toplevelOf(cwd) ?? cwd, [
    'worktree',
    'list',
    '--porcelain',
    '-z',
  ]);

  const listed = (listing ?? '')
    .split('\0')
    .filter(field => field.startsWith('worktree '))
    .map(field => field.slice('worktree '.length));

  const edited = (turn?.edits ?? [])
    .filter(edit => edit.agent === agent)
    .map(edit => toplevelOf(edit.path) ?? '');

  return [...new Set([...listed, ...edited])].filter(
    path => AGENT_WORKTREE.exec(path)?.[1] === agent,
  );
}

/** Returns the state a checkout starts the turn in. A worktree of a subagent always starts in the state it was created in, and so does any worktree made since the prompt. Every other checkout starts in the state the journal noted, null when it noted none. */
function baselineFor(root: string, turn: Turn | null): BaselineEntry | null {
  const noted = turn?.baselines.find(baseline => baseline.root === root);

  if (AGENT_WORKTREE.test(root)) {
    return creationBaseline(root, null, 0) ?? noted ?? null;
  }

  if (noted !== undefined || turn === null) {
    return noted ?? null;
  }

  return creationBaseline(root, null, turn.promptAt);
}

/**
 * Returns the state a worktree was created in, provided that happened at or after the time. The oldest reflog entry of HEAD names the commit the worktree started on, and an older worktree or one without a reflog gives null.
 * @see {@link https://git-scm.com/docs/git-reflog | git reflog}
 */
function creationBaseline(
  root: string,
  agent: string | null,
  notBefore: number,
): BaselineEntry | null {
  const output = git(root, [
    'reflog',
    'show',
    '--date=unix',
    '--format=%gd%x09%H',
    'HEAD',
  ]);

  const oldest = (output ?? '').trim().split('\n').at(-1)?.split('\t');
  const seconds = Number(oldest?.[0]?.match(/\{(\d+)\}/)?.[1]);
  const head = oldest?.[1];

  if (
    head === undefined ||
    Number.isNaN(seconds) ||
    seconds < Math.floor(notBefore / 1000)
  ) {
    return null;
  }

  return {
    at: seconds * 1000,
    agent,
    kind: 'baseline',
    root,
    head,
    dirty: {},
  };
}

/** Takes the state of the checkout at the time: the commit HEAD names, null before the first commit, and the content of every file git status names. */
function baselineOf(
  root: string,
  agent: string | null,
  at: number,
): BaselineEntry {
  const paths = statusPaths(root);
  const ids = contentIds(
    root,
    paths.map(path => join(root, path)),
  );

  const dirty: Record<string, ContentId> = {};

  for (const path of paths) {
    const id = ids.get(join(root, path));

    if (id !== undefined) {
      dirty[path] = id;
    }
  }

  return { at, agent, kind: 'baseline', root, head: headOf(root), dirty };
}

/** Lists the files of the checkout that differ from the content they held when the turn started, deleted files included. */
function changedIn(
  root: string,
  baseline: BaselineEntry | null,
  edits: EditEntry[],
): string[] {
  // 1. Gather every path that may have changed and read what it holds now. A path with no content now is a directory, which holds no rule to check.
  const status = statusPaths(root).map(path => join(root, path));
  const candidates = new Set([
    ...committedPaths(root, baseline).map(path => join(root, path)),
    ...status,
    ...Object.keys(baseline?.dirty ?? {}).map(path => join(root, path)),
    ...edits.map(edit => edit.path),
  ]);

  const now = contentIds(root, [...candidates]);
  const paths = [...now.keys()];

  // 2. Look up what each path held when the turn started: the dirty content of the baseline, else the blob of its commit, else for a path git names nowhere, a gitignored file, the content before its first Edit.
  const dirty = new Map(Object.entries(baseline?.dirty ?? {}));
  const started = baseline?.head ? treeIds(root, baseline.head, paths) : null;
  const firstEdits = new Map(
    edits.toReversed().map(edit => [edit.path, edit.before]),
  );

  const named = new Set(status);

  function contentAtStart(path: string): ContentId | null {
    if (baseline === null) {
      return firstEdits.get(path) ?? null;
    }

    const content = dirty.get(relativeTo(root, path)) ?? started?.get(path);

    if (content !== undefined) {
      return content;
    }

    return (named.has(path) ? undefined : firstEdits.get(path)) ?? MISSING;
  }

  // 3. Keep each path whose content now differs from the content it started with, and each path whose start is unknown.
  return paths.filter(path => contentAtStart(path) !== now.get(path)).sort();
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
 * Lists the files of the commits made since the baseline, by committer date, so a commit, an amend, a rebase or a cherry-pick of the turn counts and the commits a checkout or a pull brought in do not. A merge names the files its resolution changed.
 * @see {@link https://git-scm.com/docs/git-log | git log}
 */
function committedPaths(
  root: string,
  baseline: BaselineEntry | null,
): string[] {
  if (baseline === null) {
    return [];
  }

  const output = git(root, [
    'log',
    '--no-renames',
    '--name-only',
    '-z',
    '--format=',
    '--cc',
    `--since=${Math.floor(baseline.at / 1000)}`,
    baseline.head === null ? 'HEAD' : `${baseline.head}..HEAD`,
    '--',
  ]);

  return (output ?? '').split('\0').filter(path => path !== '');
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

/**
 * Reads the content id of each path as git would store it, filters of the checkout applied, so the id of a file equals the id of the same content in a commit. A path without a file maps to MISSING and a directory is left out.
 * @see {@link https://git-scm.com/docs/git-hash-object | git hash-object}
 */
function contentIds(root: string, paths: string[]): Map<string, ContentId> {
  const ids = new Map<string, ContentId>();
  const files: string[] = [];

  for (const path of paths) {
    try {
      const stat = lstatSync(path);

      if (stat.isSymbolicLink()) {
        ids.set(path, blobId(Buffer.from(readlinkSync(path))));
      } else if (stat.isFile()) {
        files.push(path);
      }
    } catch {
      ids.set(path, MISSING);
    }
  }

  for (const [index, id] of hashFiles(root, files).entries()) {
    ids.set(files[index], id);
  }

  return ids;
}

/** Hashes the files with one git call, or one call per file when a name holds a line break or the call fails, so one unreadable file costs only its own id. */
function hashFiles(root: string, files: string[]): ContentId[] {
  if (files.length === 0) {
    return [];
  }

  const batch = git(
    root,
    ['hash-object', '--stdin-paths'],
    files.map(file => `${file}\n`).join(''),
  )
    ?.trim()
    .split('\n');

  if (batch?.length === files.length && !files.some(isMultiline)) {
    return batch;
  }

  return files.map(
    file => git(root, ['hash-object', '--', file])?.trim() ?? UNREADABLE,
  );
}

/** Tells whether the name holds a line break, which a list of names read line by line cannot carry. */
function isMultiline(name: string): boolean {
  return name.includes('\n');
}

/**
 * Hashes the bytes the way git hashes a blob, which is the id of a symbolic link, the target of the link being its content.
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

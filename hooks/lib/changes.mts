// Finds the files a turn changed, however they changed, in every checkout the turn worked in, from a journal of the turn and from git.
// https://git-scm.com/docs/git-status#_porcelain_format_version_1

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { realPathOf, type SessionId, segmentsBelow } from './hook.mts';

/** What the stop found, the changed files per root of the rules and the checkouts the deadline kept from listing theirs. */
export type Discovery = {
  changes: Changes[];
  skipped: string[];
};

/** The files one turn changed that share one root for the rules, absolute, sorted and unique, deleted files included. The root is the working directory for a file in its checkout, so a package of a monorepo is the root of its own files, and the git top level for a file of any other checkout. */
export type Changes = {
  root: string;
  files: string[];
  /** The time in epoch milliseconds after which no new file is started, absent for no limit. */
  deadline?: number;
};

/** A checkout to run git in, with the time in epoch milliseconds after which no git call starts, absent for no limit. */
type Repo = {
  root: string;
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
 * One line of the journal of a session. A prompt starts the journal with its own line and a baseline, and the Edits of the turn append to it. It is the single source of a turn, and the agent is the id of the subagent that wrote the line or null for the main session.
 * @see {@link https://code.claude.com/docs/en/hooks.md | Claude Code, hooks reference}
 */
type Entry = PromptEntry | BaselineEntry | EditEntry;

/** The current turn as the journal tells it, derived on every read from the lines after the last prompt. */
type Turn = {
  promptAt: number;
  baselines: BaselineEntry[];
  edits: EditEntry[];
};

/** Thrown when the deadline passes before a git call starts or while it runs. */
class DeadlineError extends Error {}

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

/** The permission bits that let the group and other users into a folder. */
const SHARED_MODE_BITS = 0o077;

/** The flag that refuses to open a link, where the platform has it. */
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

/** Starts a new turn of the session and notes the state of the checkout it starts in. The journal then holds this turn only. Journals of long-gone sessions are deleted here. */
export function noteTurnStart(session: SessionId, cwd: string): void {
  const at = Date.now();
  const root = toplevelOf(cwd);
  const entries: Entry[] = [{ at, agent: null, kind: 'prompt', cwd }];

  if (root !== null) {
    entries.push(baselineOf({ root }, null, at));
  }

  startJournal(session, entries);
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
      creationBaseline({ root }, agent, turn.promptAt) ??
        baselineOf({ root }, agent, Date.now()),
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
    before:
      contentIds({ root: root ?? dirname(path) }, [path]).get(path) ?? MISSING,
  });
}

/** Lists what the current turn of the main session changed per checkout, nothing before its first prompt. Agent worktrees are left to their subagents. A checkout the deadline cuts short is skipped. */
export function turnChanges(
  session: SessionId,
  cwd: string,
  deadline: number,
): Discovery {
  // 1. Derive the turn from the journal, nothing to list when no prompt started one.
  const turn = turnOf(readJournal(session));

  if (turn === null) {
    return { changes: [], skipped: [] };
  }

  // 2. Place each edit in its checkout. An edit outside every repository joins the checkout of the stop, where only the comment rules reach it.
  const stopRoot = toplevelOf(cwd) ?? cwd;
  const placed = turn.edits.map(edit => ({
    edit,
    root: toplevelOf(edit.path) ?? stopRoot,
  }));

  // 3. The checkouts are those the turn left evidence in and the one the stop stands in, each once, without the worktrees of subagents.
  const roots = new Set([
    ...turn.baselines.map(baseline => baseline.root),
    ...placed.map(({ root }) => root),
    stopRoot,
  ]);

  // 4. List the changed files of each checkout and group them by the root of their rules.
  const listed = listEach(
    [...roots].filter(root => !AGENT_WORKTREE.test(root)),
    deadline,
    repo => {
      const edits = placed
        .filter(entry => entry.root === repo.root)
        .map(({ edit }) => edit);

      return changedIn(repo, baselineFor(repo, turn), edits);
    },
  );

  return {
    changes: groupByRuleRoot(cwd, listed.files),
    skipped: listed.skipped,
  };
}

/** Lists what a subagent with isolation changed in its own worktree, nothing for a subagent that works in a checkout the main session owns. A worktree the deadline cuts short is skipped. */
export function agentChanges(
  session: SessionId,
  cwd: string,
  agent: string,
  deadline: number,
): Discovery {
  const turn = turnOf(readJournal(session));

  try {
    const roots = agentWorktreesOf(
      { root: toplevelOf(cwd) ?? cwd, deadline },
      agent,
      turn,
    );

    const listed = listEach(roots, deadline, repo => {
      const edits = (turn?.edits ?? []).filter(
        edit => toplevelOf(edit.path) === repo.root,
      );

      return changedIn(repo, baselineFor(repo, turn), edits);
    });

    return {
      changes: groupByRuleRoot(cwd, listed.files),
      skipped: listed.skipped,
    };
  } catch (error) {
    if (!(error instanceof DeadlineError)) {
      throw error;
    }

    // The worktrees of the subagent could not be looked up in time, so the checkout of the stop is the one left unchecked.
    return { changes: [], skipped: [cwd] };
  }
}

/** Lists the changed files of each checkout. A checkout the deadline cuts short is skipped as a whole, so no half list is ever reported. */
function listEach(
  roots: string[],
  deadline: number,
  list: (repo: Repo) => string[],
): { files: string[]; skipped: string[] } {
  const files: string[] = [];
  const skipped: string[] = [];

  for (const root of roots) {
    try {
      files.push(...list({ root, deadline }));
    } catch (error) {
      if (!(error instanceof DeadlineError)) {
        throw error;
      }

      skipped.push(root);
    }
  }

  return { files, skipped };
}

/** Appends one entry to the journal the turn started. An append is a single write, so concurrent hooks of one session never interleave a line. A journal that is missing, or a link in its place, is not written. */
function append(session: SessionId, entry: Entry): void {
  const folder = journalFolder();

  if (folder === null) {
    return;
  }

  try {
    const journal = openSync(
      join(folder, `${session}.jsonl`),
      constants.O_WRONLY | constants.O_APPEND | NO_FOLLOW,
    );

    try {
      writeSync(journal, `${JSON.stringify(entry)}\n`);
    } finally {
      closeSync(journal);
    }
  } catch {
    // Without a journal there is no turn to add to, and a stop then stays silent.
  }
}

/**
 * Replaces the journal of the session by the entries that open the turn. They are written to a file of their own in the folder and renamed over the journal, so a reader sees the whole turn start or none of it, a torn line of an earlier hook is gone, and a link in the place of the journal is replaced instead of followed.
 * @see {@link https://man7.org/linux/man-pages/man2/rename.2.html | rename(2)}
 */
function startJournal(session: SessionId, entries: Entry[]): void {
  const folder = createJournalFolder();

  if (folder === null) {
    return;
  }

  pruneJournals(folder);

  const pending = join(folder, `${session}.${randomUUID()}.tmp`);

  try {
    const file = openSync(
      pending,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
      0o600,
    );

    try {
      writeSync(
        file,
        entries.map(entry => `${JSON.stringify(entry)}\n`).join(''),
      );
    } finally {
      closeSync(file);
    }

    renameSync(pending, join(folder, `${session}.jsonl`));
  } catch {
    // The turn goes without a journal, and a stop then stays silent.
    rmSync(pending, { force: true });
  }
}

/** Returns the folder of all journals of the user in the temporary folder, which the operating system clears. */
function journalFolderPath(): string {
  return join(tmpdir(), `forge-${process.getuid?.() ?? 'user'}`);
}

/** Creates the journal folder for the user alone when it is missing, then returns it as journalFolder does. */
function createJournalFolder(): string | null {
  try {
    mkdirSync(journalFolderPath(), { recursive: true, mode: 0o700 });
  } catch {
    // A folder that cannot be made is no folder to use, journalFolder tells.
  }

  return journalFolder();
}

/** Returns the journal folder when it is a real folder of this user that no other user can enter, otherwise null. A journal in any other folder could be planted or read by someone else. */
function journalFolder(): string | null {
  const folder = journalFolderPath();
  const uid = process.getuid?.();

  try {
    const stat = lstatSync(folder);
    const isPrivate =
      uid === undefined ||
      (stat.uid === uid && (stat.mode & SHARED_MODE_BITS) === 0);

    return stat.isDirectory() && isPrivate ? folder : null;
  } catch {
    return null;
  }
}

/** Deletes every journal that no hook wrote to for a week. A journal that cannot be deleted stays. */
function pruneJournals(folder: string): void {
  try {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);

      if (Date.now() - lstatSync(path).mtimeMs > JOURNAL_LIFETIME_MS) {
        unlinkSync(path);
      }
    }
  } catch {
    // A journal that vanished is deleted already.
  }
}

/** Reads every well-formed entry, none for a missing journal and for a link in its place. A torn line from a crashed hook is skipped. */
function readJournal(session: SessionId): Entry[] {
  const folder = journalFolder();
  let text: string;

  if (folder === null) {
    return [];
  }

  try {
    text = readFileSync(join(folder, `${session}.jsonl`), {
      encoding: 'utf8',
      flag: constants.O_RDONLY | NO_FOLLOW,
    });
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

/** Groups the files by the root their rules resolve against, in the order the roots first appear. */
function groupByRuleRoot(cwd: string, files: string[]): Changes[] {
  const cwdCheckout = toplevelOf(cwd);
  const groups = new Map<string, string[]>();

  for (const file of files) {
    const root = ruleRootOf(cwd, cwdCheckout, file);

    groups.set(root, [...(groups.get(root) ?? []), file]);
  }

  return [...groups].map(([root, group]) => ({ root, files: group.sort() }));
}

/** Returns the working directory for a file below it in the checkout of the working directory. Any other file takes the top level of its checkout, and the working directory when it lies in none. */
function ruleRootOf(
  cwd: string,
  cwdCheckout: string | null,
  file: string,
): string {
  const checkout = toplevelOf(file);
  const isInCwdCheckout = checkout === null || checkout === cwdCheckout;

  return segmentsBelow(cwd, file) !== null && isInCwdCheckout
    ? cwd
    : (checkout ?? cwd);
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
 * Lists the worktrees of the subagent: the one the worktrees of the repository of the stop name and the ones its Edits in the turn lie in. Empty when it has none.
 * @see {@link https://git-scm.com/docs/git-worktree#_list_output_format | git worktree, porcelain format}
 */
function agentWorktreesOf(
  repo: Repo,
  agent: string,
  turn: Turn | null,
): string[] {
  const listing = git(repo, ['worktree', 'list', '--porcelain', '-z']);

  const listed = (listing ?? '')
    .split('\0')
    .filter(field => field.startsWith('worktree '))
    .map(field => realPathOf(field.slice('worktree '.length)));

  const edited = (turn?.edits ?? [])
    .filter(edit => edit.agent === agent)
    .map(edit => toplevelOf(edit.path) ?? '');

  return [...new Set([...listed, ...edited])].filter(
    path => AGENT_WORKTREE.exec(path)?.[1] === agent,
  );
}

/** Returns the state a checkout starts the turn in. A worktree of a subagent always starts in the state it was created in, and so does any worktree made since the prompt. Every other checkout starts in the state the journal noted, null when it noted none. */
function baselineFor(repo: Repo, turn: Turn | null): BaselineEntry | null {
  const noted = turn?.baselines.find(baseline => baseline.root === repo.root);

  if (AGENT_WORKTREE.test(repo.root)) {
    return creationBaseline(repo, null, 0) ?? noted ?? null;
  }

  if (noted !== undefined || turn === null) {
    return noted ?? null;
  }

  return creationBaseline(repo, null, turn.promptAt);
}

/**
 * Returns the state a worktree was created in, provided that happened at or after the time. The oldest reflog entry of HEAD names the commit the worktree started on, and an older worktree or one without a reflog gives null.
 * @see {@link https://git-scm.com/docs/git-reflog | git reflog}
 */
function creationBaseline(
  repo: Repo,
  agent: string | null,
  notBefore: number,
): BaselineEntry | null {
  const output = git(repo, [
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
    root: repo.root,
    head,
    dirty: {},
  };
}

/** Takes the state of the checkout at the time: the commit HEAD names, null before the first commit, and the content of every file git status names. */
function baselineOf(
  repo: Repo,
  agent: string | null,
  at: number,
): BaselineEntry {
  const paths = statusPaths(repo);
  const ids = contentIds(
    repo,
    paths.map(path => join(repo.root, path)),
  );

  const dirty: Record<string, ContentId> = {};

  for (const path of paths) {
    const id = ids.get(join(repo.root, path));

    if (id !== undefined) {
      dirty[path] = id;
    }
  }

  return {
    at,
    agent,
    kind: 'baseline',
    root: repo.root,
    head: headOf(repo),
    dirty,
  };
}

/** Lists the files of the checkout that differ from the content they held when the turn started, deleted files included. */
function changedIn(
  repo: Repo,
  baseline: BaselineEntry | null,
  edits: EditEntry[],
): string[] {
  // 1. Gather every path that may have changed and read what it holds now. A path with no content now is a directory, which holds no rule to check.
  const status = statusPaths(repo).map(path => join(repo.root, path));
  const candidates = new Set([
    ...committedPaths(repo, baseline).map(path => join(repo.root, path)),
    ...status,
    ...Object.keys(baseline?.dirty ?? {}).map(path => join(repo.root, path)),
    ...edits.map(edit => edit.path),
  ]);

  const now = contentIds(repo, [...candidates]);
  const paths = [...now.keys()];

  // 2. Look up what each path held when the turn started: the dirty content of the baseline, else the blob of its commit, else for a path git names nowhere, a gitignored file, the content before its first Edit.
  const dirty = new Map(Object.entries(baseline?.dirty ?? {}));
  const started = baseline?.head ? treeIds(repo, baseline.head, paths) : null;
  const firstEdits = new Map(
    edits.toReversed().map(edit => [edit.path, edit.before]),
  );

  const named = new Set(status);

  function contentAtStart(path: string): ContentId | null {
    if (baseline === null) {
      return firstEdits.get(path) ?? null;
    }

    const content =
      dirty.get(relativeTo(repo.root, path)) ?? started?.get(path);

    if (content !== undefined) {
      return content;
    }

    if (named.has(path)) {
      return MISSING;
    }

    return firstEdits.get(path) ?? MISSING;
  }

  // 3. Keep each path whose content now differs from the content it started with, and each path whose start is unknown.
  return paths.filter(path => contentAtStart(path) !== now.get(path)).sort();
}

/**
 * Lists every path git status names, staged, unstaged and untracked, a rename as its two sides, without a nested repository such as an agent worktree.
 * @see {@link https://git-scm.com/docs/git-status#_porcelain_format_version_1 | git status, porcelain format version 1}
 */
function statusPaths(repo: Repo): string[] {
  const output = git(repo, [
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
function committedPaths(repo: Repo, baseline: BaselineEntry | null): string[] {
  if (baseline === null) {
    return [];
  }

  const output = git(repo, [
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
  repo: Repo,
  commit: string,
  paths: string[],
): Map<string, ContentId> {
  const ids = new Map<string, ContentId>();
  const below = paths.filter(path => segmentsBelow(repo.root, path) !== null);

  for (let start = 0; start < below.length; start += PATHS_PER_CALL) {
    const names = below
      .slice(start, start + PATHS_PER_CALL)
      .map(path => relativeTo(repo.root, path));

    const output = git(repo, ['ls-tree', '-r', '-z', commit, '--', ...names]);

    for (const entry of (output ?? '').split('\0')) {
      const tab = entry.indexOf('\t');
      const id = entry.slice(0, tab).split(' ')[2];

      if (tab !== -1) {
        ids.set(join(repo.root, entry.slice(tab + 1)), id);
      }
    }
  }

  return ids;
}

/** Returns the commit HEAD names, or null in a checkout without a commit and outside a repository. */
function headOf(repo: Repo): string | null {
  return git(repo, ['rev-parse', 'HEAD'])?.trim() ?? null;
}

/** Returns the path below the root with slashes, as git names it. */
function relativeTo(root: string, path: string): string {
  return (segmentsBelow(root, path) ?? []).join('/');
}

/**
 * Reads the content id of each path as git would store it, filters of the checkout applied, so the id of a file equals the id of the same content in a commit. A path without a file maps to MISSING and a directory is left out.
 * @see {@link https://git-scm.com/docs/git-hash-object | git hash-object}
 */
function contentIds(repo: Repo, paths: string[]): Map<string, ContentId> {
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

  for (const [index, id] of hashFiles(repo, files).entries()) {
    ids.set(files[index], id);
  }

  return ids;
}

/** Hashes the files with one git call, or one call per file when a name holds a line break or the call fails, so one unreadable file costs only its own id. */
function hashFiles(repo: Repo, files: string[]): ContentId[] {
  if (files.length === 0) {
    return [];
  }

  const batch = git(
    repo,
    ['hash-object', '--stdin-paths'],
    files.map(file => `${file}\n`).join(''),
  )
    ?.trim()
    .split('\n');

  if (batch?.length === files.length && !files.some(isMultiline)) {
    return batch;
  }

  return files.map(
    file => git(repo, ['hash-object', '--', file])?.trim() ?? UNREADABLE,
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

/** Runs git in the checkout without optional locks, so a stop never holds the index lock another session or the model needs, and with literal pathspecs. Null when git fails. The call gets the time that is left as its timeout, and a deadline that has passed or hits throws a DeadlineError. */
function git(repo: Repo, args: string[], input?: string): string | null {
  const remaining = (repo.deadline ?? Infinity) - Date.now();

  if (remaining <= 0) {
    throw new DeadlineError();
  }

  const result = spawnSync(
    'git',
    ['--no-optional-locks', '-C', repo.root, ...args],
    {
      encoding: 'utf8',
      input,
      maxBuffer: 64 * 1024 * 1024,
      timeout: Number.isFinite(remaining) ? remaining : undefined,
      env: { ...process.env, GIT_LITERAL_PATHSPECS: '1' },
    },
  );

  if (
    result.error instanceof Error &&
    'code' in result.error &&
    result.error.code === 'ETIMEDOUT'
  ) {
    throw new DeadlineError();
  }

  return result.status === 0 ? result.stdout : null;
}

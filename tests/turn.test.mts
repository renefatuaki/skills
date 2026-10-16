#!/usr/bin/env node

// Drives the turn hook the way Claude Code does, through prompts, tool events and stops in throwaway git repositories, and compares what it prints with the expected reasons.

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'hooks', 'check-turn.mts');

/** Everything the run creates lives here, the journals of the hook included, because os.tmpdir() of the hook reads TMPDIR. */
const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'turn-test-')));
const journals = join(sandbox, 'journals');

/** A TypeScript file whose comment on line 3 breaks the dash rule. */
const BAD_TS = 'export const value = 1;\n\n// Uses a dash — here.\n';

/** A TypeScript file that passes every comment rule. */
const GOOD_TS = 'export const value = 1;\n';

/** A Markdown file whose prose on line 3 breaks the dash rule and that no README links. */
const BAD_DOC = '# Guide\n\nA guide — here.\n';

/** The README of the docs folder. The diagram on line 5 has a table that links two source files. */
const README = [
  '# Docs',
  '',
  'How the code fits together.',
  '',
  '```mermaid',
  'flowchart TD',
  '  linked["Linked"] --> old["Old"]',
  '```',
  '',
  '| Element | Source |',
  '| --- | --- |',
  '| `linked` | [`linked.ts`](../src/linked.ts) |',
  '| `old` | [`old.ts`](../src/old.ts) |',
  '',
].join('\n');

/** The same README without the row of old.ts, which is how the diagram follows a deleted file. */
const README_WITHOUT_OLD = README.replace(
  '| `old` | [`old.ts`](../src/old.ts) |\n',
  '',
);

const INTRO =
  'The forge Stop hook checked every file this turn changed. Fix each line below, then end the turn.';

const COMMENTS = 'Comment rules (code-comments skill):';
const DOCS = 'Documentation rules (project-docs skill):';
const LINKED =
  'Diagrams that link a changed file (diagrams skill). Check that each one still shows what the code does, and update it when it does not:';

const DASH = 'em-dash Replace the dash with a period or a comma.';

/** The checkouts of the story. The ticket worktree and the unseen worktree are siblings of the repository, the agent worktree sits inside it. */
type Story = {
  repo: string;
  ticket: string;
  unseen: string;
  agent: string;
  plain: string;
};

let failures = 0;

const story = setUp();

runTurnOne(story);
runTurnTwo(story);
runBaseline();
runMidTurnCheckouts();
runCheckoutFilters();
runDeadline();

console.log(
  failures === 0
    ? 'All steps pass.'
    : `${failures} step(s) failed, the story stays in ${sandbox}.`,
);

if (failures === 0) {
  rmSync(sandbox, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);

/** Builds the state before the first turn, which no stop may report: a repository with a dirty file, a restored one, a branch, an agent worktree and a diagram. */
function setUp(): Story {
  const repo = join(sandbox, 'repo');
  const story: Story = {
    repo,
    ticket: join(sandbox, 'repo-42'),
    unseen: join(sandbox, 'repo-43'),
    agent: join(repo, '.claude', 'worktrees', 'agent-abc'),
    plain: join(sandbox, 'plain'),
  };

  mkdirSync(repo, { recursive: true });
  mkdirSync(story.plain);
  git(repo, 'init', '-q', '-b', 'main');

  write(join(repo, '.gitignore'), 'ignored/\n');
  write(join(repo, 'src/clean.ts'), GOOD_TS);
  write(join(repo, 'src/dirty.ts'), GOOD_TS);
  write(join(repo, 'src/restored.ts'), BAD_TS);
  write(join(repo, 'src/noop.ts'), BAD_TS);
  write(join(repo, 'src/linked.ts'), GOOD_TS);
  write(join(repo, 'src/old.ts'), GOOD_TS);
  write(join(repo, 'docs/README.md'), README);
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');

  git(repo, 'checkout', '-q', '-b', 'other');
  write(join(repo, 'src/branch-only.ts'), BAD_TS);
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'branch only');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'worktree', 'add', '-q', '--detach', story.agent);

  // The dirty file keeps a dash and the restored one lost it, both uncommitted, so neither may show up unless the turn touches it.
  write(join(repo, 'src/dirty.ts'), BAD_TS);
  write(join(repo, 'src/restored.ts'), GOOD_TS);

  // Reflog entries and the start of a turn count in whole seconds, so the setup must end before the second the prompt falls in.
  waitForNextSecond();

  return story;
}

/** Runs turn one of session s1 and then the stops that judge it. The comment on each change names the absence it pairs with a presence. */
function runTurnOne(story: Story): void {
  const { repo, ticket, unseen, agent, plain } = story;

  hook(prompt('s1', repo));
  hook(prompt('s2', plain));

  // A branch checkout that stays brings branch-only.ts in. It equals HEAD and the turn wrote it nowhere, so it is absent next to every file the turn wrote.
  git(repo, 'checkout', '-q', 'other');

  // An Edit through PreToolUse is present. An Edit that changes nothing is absent, because the content before and after is the same.
  hook(edit('s1', repo, join(repo, 'src/edited.ts')));
  write(join(repo, 'src/edited.ts'), BAD_TS);
  hook(edit('s1', repo, join(repo, 'src/noop.ts')));

  // A shell write that no tool event announced is present.
  write(join(repo, 'src/bash.ts'), BAD_TS);

  // A file that was dirty before the turn and went back to the content of HEAD is present. The dirty file the turn never touched is absent.
  git(repo, 'checkout', '--', 'src/restored.ts');

  // A commit inside the turn is present, though HEAD now equals the working tree.
  write(join(repo, 'src/committed.ts'), BAD_TS);
  git(repo, 'add', 'src/committed.ts');
  git(repo, 'commit', '-q', '-m', 'committed');

  // An amend that drops a file from the commit leaves it in the working tree. Both files are present.
  write(join(repo, 'src/amend-keep.ts'), BAD_TS);
  write(join(repo, 'src/amend-drop.ts'), BAD_TS);
  git(repo, 'add', 'src/amend-keep.ts', 'src/amend-drop.ts');
  git(repo, 'commit', '-q', '-m', 'amended');
  git(repo, 'rm', '-q', '--cached', 'src/amend-drop.ts');
  git(repo, 'commit', '-q', '--amend', '--no-edit');

  // A gitignored file edited through PreToolUse is present. The one a shell wrote is absent, because nothing names it.
  hook(edit('s1', repo, join(repo, 'ignored/secret.ts')));
  write(join(repo, 'ignored/secret.ts'), BAD_TS);
  write(join(repo, 'ignored/bash.ts'), BAD_TS);

  // A documentation file and the files a linked diagram names.
  write(join(repo, 'docs/guide.md'), BAD_DOC);
  write(join(repo, 'src/linked.ts'), `${GOOD_TS}export const more = 2;\n`);
  rmSync(join(repo, 'src/old.ts'));

  // A checkout entered mid-turn through PreToolUse is present, its file written by the shell after a commit included. A sibling checkout nothing names is absent.
  git(repo, 'worktree', 'add', '-q', '-b', 'ticket-42', ticket);
  hook(edit('s1', repo, join(ticket, 'src/sibling-edit.ts')));
  write(join(ticket, 'src/sibling-edit.ts'), BAD_TS);
  write(join(ticket, 'src/sibling-bash.ts'), BAD_TS);
  git(ticket, 'add', '.');
  git(ticket, 'commit', '-q', '-m', 'ticket');
  git(repo, 'worktree', 'add', '-q', '-b', 'ticket-43', unseen);
  write(join(unseen, 'src/other-session.ts'), BAD_TS);
  git(unseen, 'add', '.');
  git(unseen, 'commit', '-q', '-m', 'other session');

  // A subagent writes in its own worktree, which only its SubagentStop checks.
  hook(edit('s1', repo, join(agent, 'src/agent.ts'), 'abc'));
  write(join(agent, 'src/agent.ts'), BAD_TS);

  // Outside any repository only the edit of the turn is checked. The file a shell wrote there is absent.
  hook(edit('s2', plain, join(plain, 'notes.ts')));
  write(join(plain, 'notes.ts'), BAD_TS);
  write(join(plain, 'other.ts'), BAD_TS);

  expect(
    'a stop names every file the turn changed, however it changed, and the diagram that links a changed or deleted file',
    stop('s1', repo),
    [
      INTRO,
      '',
      COMMENTS,
      `ignored/secret.ts:3 ${DASH}`,
      `src/amend-drop.ts:3 ${DASH}`,
      `src/amend-keep.ts:3 ${DASH}`,
      `src/bash.ts:3 ${DASH}`,
      `src/committed.ts:3 ${DASH}`,
      `src/edited.ts:3 ${DASH}`,
      `src/restored.ts:3 ${DASH}`,
      `${ticket}/src/sibling-bash.ts:3 ${DASH}`,
      `${ticket}/src/sibling-edit.ts:3 ${DASH}`,
      '',
      DOCS,
      'docs/guide.md:1 unlinked Link this file from the README table.',
      `docs/guide.md:3 ${DASH}`,
      '',
      LINKED,
      'docs/README.md:5 linked src/linked.ts, src/old.ts',
    ].join('\n'),
  );

  expect(
    'the stop after a blocked stop stays silent',
    stop('s1', repo, true),
    '',
  );

  expect(
    'a session that never sent a prompt stays silent',
    stop('never-prompted', repo),
    '',
  );

  expect(
    'a subagent stop checks the worktree of the subagent and nothing else',
    subagentStop('s1', repo, 'abc'),
    [
      INTRO,
      '',
      COMMENTS,
      `.claude/worktrees/agent-abc/src/agent.ts:3 ${DASH}`,
    ].join('\n'),
  );

  expect(
    'a subagent without a worktree stays silent',
    subagentStop('s1', repo, 'nobody'),
    '',
  );

  expect(
    'a subagent stop that already blocked once stays silent',
    subagentStop('s1', repo, 'abc', true),
    '',
  );

  expect(
    'outside any repository the stop checks the edit and not the shell write',
    stop('s2', plain),
    [INTRO, '', COMMENTS, `notes.ts:3 ${DASH}`].join('\n'),
  );
}

/** Runs turn two of session s1, in which the diagram follows its source and the stops tell whether the diagram file itself changed. */
function runTurnTwo({ repo }: Story): void {
  waitForNextSecond();
  hook(prompt('s1', repo));
  write(join(repo, 'src/linked.ts'), `${GOOD_TS}export const more = 3;\n`);

  expect(
    'a diagram that links a changed file is named while its own file is untouched',
    stop('s1', repo),
    [INTRO, '', LINKED, 'docs/README.md:5 linked src/linked.ts'].join('\n'),
  );

  hook(edit('s1', repo, join(repo, 'docs/README.md')));
  write(join(repo, 'docs/README.md'), README_WITHOUT_OLD);

  expect(
    'the diagram is not named once its own file changed in the turn',
    stop('s1', repo),
    '',
  );
}

/** Runs a small repository against the deadline, once with the budget used up and once with the default one. */
function runDeadline(): void {
  const repo = join(sandbox, 'deadline');

  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  hook(prompt('s3', repo));
  write(join(repo, 'a.ts'), BAD_TS);

  expect(
    'a stop with no time left names the files it did not check',
    stop('s3', repo),
    [INTRO, '', 'Not checked in time: 1 file, starting with a.ts.'].join('\n'),
    { FORGE_CHECK_BUDGET_MS: '0' },
  );

  expect(
    'the same stop with the default budget checks the file',
    stop('s3', repo),
    [INTRO, '', COMMENTS, `a.ts:3 ${DASH}`].join('\n'),
  );
}

/** A Bash write followed by an Edit that changes nothing, as a denied or failed Edit does, still counts. An untouched file next to them does not. */
function runBaseline(): void {
  const repo = makeRepo('baseline', {
    'a.ts': GOOD_TS,
    'calm.ts': GOOD_TS,
  });

  hook(prompt('b1', repo));
  write(join(repo, 'a.ts'), BAD_TS);
  hook(edit('b1', repo, join(repo, 'a.ts')));
  write(join(repo, 'new.ts'), BAD_TS);
  hook(edit('b1', repo, join(repo, 'new.ts')));
  hook(edit('b1', repo, join(repo, 'calm.ts')));

  expect(
    'a shell write to a tracked and to a new file stays visible after an Edit that changed nothing',
    stop('b1', repo),
    [INTRO, '', COMMENTS, `a.ts:3 ${DASH}`, `new.ts:3 ${DASH}`].join('\n'),
  );
}

/** Checkouts the turn enters after its prompt start from the state they were created in, and so does the worktree of a subagent. */
function runMidTurnCheckouts(): void {
  // A ticket worktree made mid-turn. The shell writes in it before the first Edit does, and the file it inherited stays out.
  const repo = makeRepo('mid-turn', {
    'a.ts': GOOD_TS,
    'inherited.ts': BAD_TS,
  });

  const ticket = join(sandbox, 'mid-turn-42');

  hook(prompt('t1', repo));
  git(repo, 'worktree', 'add', '-q', '-b', 'ticket-42', ticket);
  write(join(ticket, 'scaffold.ts'), BAD_TS);
  hook(edit('t1', repo, join(ticket, 'later.ts')));
  write(join(ticket, 'later.ts'), GOOD_TS);

  expect(
    'a file the shell wrote in a worktree made mid-turn is named, the inherited one is not',
    stop('t1', repo),
    [INTRO, '', COMMENTS, `${ticket}/scaffold.ts:3 ${DASH}`].join('\n'),
  );

  // A subagent worktree made mid-turn. The heredoc of the subagent comes before its first Edit.
  const agent = join(repo, '.claude', 'worktrees', 'agent-q');

  git(repo, 'worktree', 'add', '-q', '--detach', agent);
  write(join(agent, 'heredoc.ts'), BAD_TS);
  hook(edit('t1', repo, join(agent, 'later.ts'), 'q'));
  write(join(agent, 'later.ts'), GOOD_TS);

  expect(
    'a subagent stop names the file the subagent wrote before its first Edit and not the inherited one',
    subagentStop('t1', repo, 'q'),
    [
      INTRO,
      '',
      COMMENTS,
      `.claude/worktrees/agent-q/heredoc.ts:3 ${DASH}`,
    ].join('\n'),
  );

  // A subagent that keeps working across a new prompt of the user.
  const spanning = join(repo, '.claude', 'worktrees', 'agent-bg');

  git(repo, 'worktree', 'add', '-q', '--detach', spanning);
  hook(prompt('t2', repo));
  hook(edit('t2', repo, join(spanning, 'first.ts'), 'bg'));
  write(join(spanning, 'first.ts'), BAD_TS);
  hook(prompt('t2', repo));
  hook(edit('t2', repo, join(spanning, 'second.ts'), 'bg'));
  write(join(spanning, 'second.ts'), GOOD_TS);

  expect(
    'a subagent stop names what the subagent wrote before a later prompt of the user',
    subagentStop('t2', repo, 'bg'),
    [INTRO, '', COMMENTS, `.claude/worktrees/agent-bg/first.ts:3 ${DASH}`].join(
      '\n',
    ),
  );

  // A subagent stop whose working directory lies in another repository finds the worktree through the journal.
  const elsewhere = makeRepo('mid-turn-elsewhere', { 'b.ts': GOOD_TS });
  const remote = join(repo, '.claude', 'worktrees', 'agent-zed');

  hook(prompt('t3', repo));
  git(repo, 'worktree', 'add', '-q', '--detach', remote);
  hook(edit('t3', repo, join(remote, 'z.ts'), 'zed'));
  write(join(remote, 'z.ts'), BAD_TS);

  expect(
    'a subagent stop from another repository finds the worktree the subagent edited in',
    subagentStop('t3', elsewhere, 'zed'),
    [INTRO, '', COMMENTS, `${remote}/z.ts:3 ${DASH}`].join('\n'),
  );

  expect(
    'a subagent stop from another repository stays silent for an agent that edited nowhere',
    subagentStop('t3', elsewhere, 'nobody'),
    '',
  );
}

/** Commits are told from the files a checkout brought in by their committer date, and the content of a file is compared the way git stores it. */
function runCheckoutFilters(): void {
  // A checkout under core.autocrlf rewrites a file with other line endings than the blob. The file stays absent, the Edit stays present.
  const crlf = makeRepo('crlf', { 'a.ts': GOOD_TS }, true);

  git(crlf, 'checkout', '-q', '-b', 'other');
  write(join(crlf, 'branch-only.ts'), BAD_TS);
  git(crlf, 'add', '.');
  git(crlf, 'commit', '-q', '-m', 'branch only');
  git(crlf, 'checkout', '-q', 'main');
  waitForNextSecond();
  hook(prompt('c1', crlf));
  git(crlf, 'checkout', '-q', 'other');
  hook(edit('c1', crlf, join(crlf, 'edited.ts')));
  write(join(crlf, 'edited.ts'), BAD_TS);

  expect(
    'a file a checkout wrote with other line endings is not named, an edited file is',
    stop('c1', crlf),
    [INTRO, '', COMMENTS, `edited.ts:3 ${DASH}`].join('\n'),
  );

  // A rebase that stops on a conflict ends in a commit the reflog does not call a commit. The file the conflict resolution wrote is named, the file the base branch brought in is not.
  const rebase = makeRepo('rebase', { 'a.ts': GOOD_TS });

  git(rebase, 'checkout', '-q', '-b', 'feature');
  write(join(rebase, 'a.ts'), `${GOOD_TS}export const feature = 2;\n`);
  git(rebase, 'commit', '-q', '-am', 'feature');
  git(rebase, 'checkout', '-q', 'main');
  write(join(rebase, 'a.ts'), `${GOOD_TS}export const main = 3;\n`);
  write(join(rebase, 'main-only.ts'), BAD_TS);
  git(rebase, 'add', '.');
  git(rebase, 'commit', '-q', '-m', 'main change');
  git(rebase, 'checkout', '-q', 'feature');
  waitForNextSecond();
  hook(prompt('c2', rebase));
  gitMayFail(rebase, 'rebase', 'main');
  write(join(rebase, 'a.ts'), BAD_TS);
  git(rebase, 'add', 'a.ts');
  git(rebase, '-c', 'core.editor=true', 'rebase', '--continue');

  expect(
    'the file a rebase conflict resolution wrote is named, the file the base brought in is not',
    stop('c2', rebase),
    [INTRO, '', COMMENTS, `a.ts:3 ${DASH}`].join('\n'),
  );
}

/** The input of UserPromptSubmit. */
function prompt(session: string, cwd: string): Record<string, unknown> {
  return {
    hook_event_name: 'UserPromptSubmit',
    session_id: session,
    cwd,
    prompt: 'go',
  };
}

/** The input of PreToolUse for a Write, which fires before the file changes. A hook that fires inside a subagent also carries its agent id. */
function edit(
  session: string,
  cwd: string,
  path: string,
  agent?: string,
): Record<string, unknown> {
  return {
    hook_event_name: 'PreToolUse',
    session_id: session,
    cwd,
    tool_name: 'Write',
    tool_input: { file_path: path },
    ...(agent === undefined ? {} : { agent_id: agent }),
  };
}

/** The input of Stop. */
function stop(
  session: string,
  cwd: string,
  active = false,
): Record<string, unknown> {
  return {
    hook_event_name: 'Stop',
    session_id: session,
    cwd,
    stop_hook_active: active,
  };
}

/** The input of SubagentStop. */
function subagentStop(
  session: string,
  cwd: string,
  agent: string,
  active = false,
): Record<string, unknown> {
  return {
    hook_event_name: 'SubagentStop',
    session_id: session,
    cwd,
    agent_id: agent,
    stop_hook_active: active,
  };
}

/** The environment of git and of the hook in the story, without the configuration of the machine and with an author for the commits. */
function environment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    TMPDIR: journals,
    ...extra,
  };
}

/** Runs git in a checkout of the story and fails the test when git fails. */
function git(cwd: string, ...args: string[]): void {
  const result = runGit(cwd, args);

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

/** Runs git in a checkout of the story and leaves a failure to the caller, as a rebase that stops on a conflict. */
function gitMayFail(cwd: string, ...args: string[]): void {
  runGit(cwd, args);
}

function runGit(cwd: string, args: string[]) {
  return spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: environment(),
  });
}

/** Creates a repository on main with one commit that holds the files. */
function makeRepo(
  name: string,
  files: Record<string, string>,
  autocrlf = false,
): string {
  const repo = join(sandbox, name);

  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');

  if (autocrlf) {
    git(repo, 'config', 'core.autocrlf', 'true');
  }

  for (const [path, content] of Object.entries(files)) {
    write(join(repo, path), content);
  }

  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');

  return repo;
}

/** Writes a file and the folders above it. */
function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** Runs the hook as Claude Code would, with the journals of this run, and returns the reason it blocks with, empty for silence. */
function hook(
  input: Record<string, unknown>,
  env: Record<string, string> = {},
): string {
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: environment(env),
  });

  if (result.status !== 0) {
    throw new Error(`hook exited with ${result.status}: ${result.stderr}`);
  }

  if (result.stdout === '') {
    return '';
  }

  const output: { decision: string; reason: string } = JSON.parse(
    result.stdout,
  );

  if (output.decision !== 'block') {
    throw new Error(`hook printed ${result.stdout}`);
  }

  return output.reason;
}

/** Blocks until the clock enters the next second, so writes before it fall before the start of the turn the next prompt opens. */
function waitForNextSecond(): void {
  const wait = 1000 - (Date.now() % 1000) + 5;

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
}

/** Runs one stop against the hook and checks the reason it blocks with. */
function expect(
  name: string,
  input: Record<string, unknown>,
  expected: string,
  env: Record<string, string> = {},
): void {
  check(name, hook(input, env), expected);
}

/** Prints PASS or FAIL with the difference and counts a failure. */
function check<T>(name: string, actual: T, expected: T): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);

  if (!ok) {
    failures++;
  }

  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  if (!ok) {
    console.log(`  expected:\n${show(expected)}\n  actual:\n${show(actual)}`);
  }
}

/** Shows a string as it is and anything else as JSON. */
function show(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

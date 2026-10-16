// Folds what happens in a session into the run of the progress band and lays out the band's line, with no Node and no engine.
// https://code.claude.com/docs/en/plugins/mods/events.md

/** Where an item of the list stands, as TodoWrite and the Task tools spell it. */
type ItemStatus = 'pending' | 'in_progress' | 'completed';

/** A todo or a task of the main session's list, with the id TaskCreate's result gave a task and null for a TodoWrite todo. */
export type Item = {
  readonly id: string | null;
  readonly title: string;
  readonly status: ItemStatus;
};

/** The Codex usage left of the 5-hour and the weekly window in whole percents and whether either is below the minimum, as `codex-model.mts --usage` reported them. */
export type Budget = {
  readonly primary: number | null;
  readonly secondary: number | null;
  readonly belowMinimum: boolean;
};

/** The state of the progress band, its list null between runs, written only through `step`. */
export type Run = {
  /** The list as the tool that wrote it last keeps it, replaced whole by a call of the other tool, never empty. */
  readonly list: {
    readonly tool: 'TodoWrite' | 'Tasks';
    readonly items: readonly Item[];
  } | null;
  /** Holds the last read's answer, null before it and when Codex cannot be read. */
  readonly budget: Budget | null;
};

type List = NonNullable<Run['list']>;

/** One thing that happened in the session, parsed from an engine event at the hook boundary. */
export type Event =
  | { readonly kind: 'todosWritten'; readonly todos: readonly Item[] }
  | { readonly kind: 'taskCreated'; readonly task: Item }
  | {
      readonly kind: 'taskEdited';
      readonly id: string;
      readonly title: string | undefined;
      readonly status: ItemStatus | undefined;
    }
  | { readonly kind: 'taskDeleted'; readonly id: string }
  | { readonly kind: 'personPrompted' }
  | { readonly kind: 'cleared' }
  | { readonly kind: 'codexRead'; readonly budget: Budget | null };

/** The run after one event and whether the event started a run, which is due a Codex read. */
export type Step = {
  readonly run: Run;
  readonly startRead: boolean;
};

/** How a part of the line reads, plain for the progress, quiet for the Codex usage, alarm below the Codex minimum. */
export type Tone = 'plain' | 'quiet' | 'alarm';

export type Segment = {
  readonly text: string;
  readonly tone: Tone;
};

/** The band's one line as its parts in order, already cut to the band's width. */
export type BandLine = readonly [Segment, ...Segment[]];

export const INITIAL_RUN: Run = { list: null, budget: null };

/** The fewest columns between the progress and the Codex text at the right edge. */
const MIN_GAP = 4;

/** Applies one event to the run, the only way the run changes. */
export function step(run: Run, event: Event): Step {
  switch (event.kind) {
    case 'todosWritten':
      return settle(run, listOf('TodoWrite', event.todos));
    case 'taskCreated':
      return settle(run, withTask(run.list, event.task));
    case 'taskEdited':
      return settle(run, editedTask(run.list, event));
    case 'taskDeleted':
      return settle(run, withoutTask(run.list, event.id));
    case 'personPrompted':
      return { run: dismissed(run), startRead: false };
    case 'cleared':
      return { run: { ...run, list: null }, startRead: false };
    case 'codexRead':
      return { run: { ...run, budget: event.budget }, startRead: false };
    default:
      return unreachable(event);
  }
}

/** Lays out the band for the run at the given width, null when the band shows nothing. */
export function bandLine(run: Run, columns: number): BandLine | null {
  if (run.list === null) {
    return null;
  }

  const { items } = run.list;
  const count = `${items.filter(item => item.status === 'completed').length}/${items.length}`;
  const current =
    items.find(item => item.status === 'in_progress') ??
    items.find(item => item.status === 'pending');

  const codex = codexText(run.budget);

  if (current === undefined) {
    return fitted(`${count} done`, '', codex, columns);
  }

  const title = singleLine(current.title);

  return fitted(title === '' ? count : `${count} · `, title, codex, columns);
}

/** Reads the one JSON line of `codex-model.mts --usage`, null when it is no usage report. */
export function parseUsage(stdout: string): Budget | null {
  const line = stdout.trim().split('\n').at(-1) ?? '';
  let value: unknown;

  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }

  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const report = value as Record<string, unknown>;
  const { primary, secondary, belowMinimum } = report;

  if (
    typeof belowMinimum !== 'boolean' ||
    !isPercentOrNull(primary) ||
    !isPercentOrNull(secondary)
  ) {
    return null;
  }

  return { primary, secondary, belowMinimum };
}

function isPercentOrNull(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= 100)
  );
}

/** Moves the run to its next list and starts a read when a run begins. */
function settle(run: Run, next: List | null): Step {
  if (next === null) {
    return { run: { ...run, list: null }, startRead: false };
  }

  // A finished list replaces a shown one and is dropped between runs, so a list rewritten after the person's prompt stays hidden.
  if (!hasOpen(next)) {
    return {
      run: { ...run, list: run.list === null ? null : next },
      startRead: false,
    };
  }

  const wasOpen = run.list !== null && hasOpen(run.list);

  return { run: { ...run, list: next }, startRead: !wasOpen };
}

/** Wraps items into a list, null for none. */
function listOf(tool: List['tool'], items: readonly Item[]): List | null {
  return items.length === 0 ? null : { tool, items };
}

/** Appends a created task to a task list, or starts a task list in place of a TodoWrite list or none. */
function withTask(list: Run['list'], task: Item): List {
  const items = list?.tool === 'Tasks' ? list.items : [];

  return { tool: 'Tasks', items: [...items, task] };
}

/** Applies a task's new title and status, leaving the list as it is for a task it does not hold. */
function editedTask(
  list: Run['list'],
  edit: Extract<Event, { kind: 'taskEdited' }>,
): List | null {
  if (list?.tool !== 'Tasks') {
    return list;
  }

  return listOf(
    'Tasks',
    list.items.map(task =>
      task.id === edit.id
        ? {
            ...task,
            title: edit.title ?? task.title,
            status: edit.status ?? task.status,
          }
        : task,
    ),
  );
}

/** Removes a deleted task, null when it was the last one. */
function withoutTask(list: Run['list'], id: string): List | null {
  if (list?.tool !== 'Tasks') {
    return list;
  }

  return listOf(
    'Tasks',
    list.items.filter(task => task.id !== id),
  );
}

/** Ends a finished run on the person's prompt and leaves an open one as it is. */
function dismissed(run: Run): Run {
  return run.list !== null && !hasOpen(run.list) ? { ...run, list: null } : run;
}

function unreachable(event: never): never {
  throw new Error(`Unknown event ${JSON.stringify(event)}`);
}

function hasOpen(list: List): boolean {
  return list.items.some(item => item.status !== 'completed');
}

/** Turns every run of line breaks and control characters into one space, so a title draws on one line. */
function singleLine(title: string): string {
  return title.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').trim();
}

type CodexText = { text: string; tone: Tone } | null;

/** Words the usage left, red with `(below minimum)` when either window has less left than the Codex minimum, whether credits pay or not. */
function codexText(budget: Budget | null): CodexText {
  if (budget === null) {
    return null;
  }

  const shown = [
    { label: '5h', left: budget.primary },
    { label: 'week', left: budget.secondary },
  ]
    .filter(window => window.left !== null)
    .map(window => `${window.label} ${window.left}%`);

  if (shown.length === 0) {
    return null;
  }

  const text = `Codex ${shown.join(' · ')}`;

  return budget.belowMinimum
    ? { text: `${text} (below minimum)`, tone: 'alarm' }
    : { text, tone: 'quiet' };
}

/** Counts a character as one column, with the outer Text cutting at the cell edge for a wide glyph. */
function width(text: string): number {
  return [...text].length;
}

/** Cuts the title so head, title, gap and Codex text fit the columns, and pushes the Codex text to the right edge, leaving it out when the title would vanish. */
function fitted(
  head: string,
  title: string,
  codex: CodexText,
  columns: number,
): BandLine {
  const roomBesideCodex =
    codex === null ? 0 : columns - width(head) - MIN_GAP - width(codex.text);

  const keepsCodex = codex !== null && roomBesideCodex > 0;
  const room = keepsCodex ? roomBesideCodex : columns - width(head);
  const cut =
    width(title) <= room
      ? title
      : `${[...title].slice(0, Math.max(0, room - 1)).join('')}…`;

  const progress: Segment = { text: `${head}${cut}`, tone: 'plain' };

  if (!keepsCodex) {
    return [progress];
  }

  const pad = columns - width(progress.text) - width(codex.text);

  return [
    progress,
    { text: `${' '.repeat(pad)}${codex.text}`, tone: codex.tone },
  ];
}

// Folds what happens in a session into the run of the progress band, reads what the band shows and lays out the terminal's line, with no Node and no engine.
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
  /** Holds the whole percent left of Claude Code's current session, its 5-hour window, null before a reading and off a subscription. */
  readonly claude: number | null;
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
  | { readonly kind: 'codexRead'; readonly budget: Budget | null }
  | { readonly kind: 'claudeMeasured'; readonly left: number | null };

/** How a part of the line reads, plain for the progress, quiet for the Claude and the Codex usage, alarm below the Codex minimum. */
export type Tone = 'plain' | 'quiet' | 'alarm';

/** The Codex usage left as each window that reported it, such as `5h 62%`, alarm when either window is below the minimum. */
export type CodexUsage = {
  readonly windows: readonly [string, ...string[]];
  readonly tone: Exclude<Tone, 'plain'>;
};

/** The Claude usage left of the current session as its window, such as `5h 77%`. */
export type ClaudeUsage = {
  readonly window: string;
};

/** What the band shows of the list. */
export type Progress = {
  /** The completed items over all items, such as `5/8`. */
  readonly count: string;
  /** The completed share of the items as a whole percentage rounded down, such as `62%`, so it reads `100%` only once every item is done. */
  readonly filled: string;
  /** The title of the item in progress or else of the first pending one on one line, null once every item is done. */
  readonly title: string | null;
};

/** What the band shows for a run on every surface, before a surface lays it out, any of the Claude usage, the progress and the Codex usage but never none. */
export type Band =
  | {
      readonly claude: ClaudeUsage;
      readonly progress: Progress | null;
      readonly codex: CodexUsage | null;
    }
  | {
      readonly claude: null;
      readonly progress: Progress;
      readonly codex: CodexUsage | null;
    }
  | {
      readonly claude: null;
      readonly progress: null;
      readonly codex: CodexUsage;
    };

export type Segment = {
  readonly text: string;
  readonly tone: Tone;
};

/** The band's one line as its parts in order, already cut to the band's width. */
export type BandLine = readonly [Segment, ...Segment[]];

export const INITIAL_RUN: Run = { list: null, budget: null, claude: null };

/** The fewest columns between the progress and the Codex text at the right edge. */
const MIN_GAP = 4;

/** Applies one event to the run, the only way the run changes. */
export function step(run: Run, event: Event): Run {
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
      return dismissed(run);
    case 'cleared':
      return { ...run, list: null };
    case 'codexRead':
      return { ...run, budget: event.budget };
    case 'claudeMeasured':
      return { ...run, claude: event.left };
    default:
      return unreachable(event);
  }
}

/** Reads what the band shows for the run, null when it has no Claude usage, no list and no Codex usage. */
export function bandOf(run: Run): Band | null {
  const claude = run.claude === null ? null : { window: `5h ${run.claude}%` };
  const progress = run.list === null ? null : progressOf(run.list);
  const codex = codexUsage(run.budget);

  if (claude !== null) {
    return { claude, progress, codex };
  }

  if (progress !== null) {
    return { claude: null, progress, codex };
  }

  return codex === null ? null : { claude: null, progress: null, codex };
}

/** Lays out the band in characters at the given width, the terminal's one line, the Codex usage at the right edge and the Claude usage at the left edge, which gives way only once it and the head of the progress no longer fit the columns together. */
export function bandLine(band: Band, columns: number): BandLine {
  const codex = band.codex === null ? null : codexText(band.codex);

  if (band.progress === null) {
    return band.claude === null
      ? [atRightEdge(codexText(band.codex), 0, columns)]
      : fitted(claudeText(band.claude, ''), '', codex, columns);
  }

  const head = plain(headOf(band.progress));
  const title = band.progress.title ?? '';
  const claude = band.claude === null ? null : claudeText(band.claude, ' · ');

  if (claude === null || width(claude.text) + width(head.text) > columns) {
    return fitted(head, title, codex, columns);
  }

  return [claude, ...fitted(head, title, codex, columns - width(claude.text))];
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

/** Moves the run to its next list. */
function settle(run: Run, next: List | null): Run {
  // A finished list replaces a shown one and is dropped between runs, so a list rewritten after the person's prompt stays hidden.
  if (next !== null && !hasOpen(next)) {
    return { ...run, list: run.list === null ? null : next };
  }

  return { ...run, list: next };
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

function progressOf({ items }: List): Progress {
  const done = items.filter(item => item.status === 'completed').length;
  const current =
    items.find(item => item.status === 'in_progress') ??
    items.find(item => item.status === 'pending');

  return {
    count: `${done}/${items.length}`,
    filled: `${Math.floor((done / items.length) * 100)}%`,
    title: current === undefined ? null : singleLine(current.title),
  };
}

function hasOpen(list: List): boolean {
  return list.items.some(item => item.status !== 'completed');
}

/** Turns every run of line breaks and control characters into one space, so a title draws on one line. */
function singleLine(title: string): string {
  return title.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').trim();
}

/** Words each window that reported the usage left, alarm when either window has less left than the Codex minimum, whether credits pay or not. */
function codexUsage(budget: Budget | null): CodexUsage | null {
  if (budget === null) {
    return null;
  }

  const [first, ...rest] = [
    { label: '5h', left: budget.primary },
    { label: 'week', left: budget.secondary },
  ]
    .filter(window => window.left !== null)
    .map(window => `${window.label} ${window.left}%`);

  if (first === undefined) {
    return null;
  }

  return {
    windows: [first, ...rest],
    tone: budget.belowMinimum ? 'alarm' : 'quiet',
  };
}

/** Writes the usage as one text, with `(below minimum)` after it in the alarm tone. */
function codexText(usage: CodexUsage): Segment {
  const text = `Codex ${usage.windows.join(' · ')}`;

  return usage.tone === 'alarm'
    ? { text: `${text} (below minimum)`, tone: 'alarm' }
    : { text, tone: 'quiet' };
}

/** Writes the Claude usage as one text with the separator from the progress after it. */
function claudeText(usage: ClaudeUsage, separator: string): Segment {
  return { text: `Claude ${usage.window}${separator}`, tone: 'quiet' };
}

/** Writes the part of the progress that is never cut, the count with `done` or with the dot before the title. */
function headOf({ count, title }: Progress): string {
  if (title === null) {
    return `${count} done`;
  }

  return title === '' ? count : `${count} · `;
}

function plain(text: string): Segment {
  return { text, tone: 'plain' };
}

/** Counts a character as one column, with the outer Text cutting at the cell edge for a wide glyph. */
function width(text: string): number {
  return [...text].length;
}

/** Cuts the title so head, title, gap and Codex text fit the columns, and pushes the Codex text to the right edge, leaving it out when the title would vanish. */
function fitted(
  head: Segment,
  title: string,
  codex: Segment | null,
  columns: number,
): BandLine {
  const roomBesideCodex =
    codex === null
      ? 0
      : columns - width(head.text) - MIN_GAP - width(codex.text);

  const keepsCodex = codex !== null && roomBesideCodex > 0;
  const room = keepsCodex ? roomBesideCodex : columns - width(head.text);
  const cut =
    width(title) <= Math.max(0, room)
      ? title
      : `${[...title].slice(0, Math.max(0, room - 1)).join('')}…`;

  const progress: Segment = { text: `${head.text}${cut}`, tone: head.tone };

  if (!keepsCodex) {
    return [progress];
  }

  return [progress, atRightEdge(codex, width(progress.text), columns)];
}

/** Pads the Codex text after the columns already taken so it ends at the right edge, with no pad where it does not fit. */
function atRightEdge(codex: Segment, taken: number, columns: number): Segment {
  const pad = Math.max(0, columns - taken - width(codex.text));

  return { text: `${' '.repeat(pad)}${codex.text}`, tone: codex.tone };
}

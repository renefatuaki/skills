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

/** The providers whose usage the band shows at the right edge, in the order it lays them out. */
export const PROVIDERS = ['codex', 'antigravity'] as const;

export type Provider = (typeof PROVIDERS)[number];

/** A limit of a provider under the name the band shows, such as `5h`, with the whole percent left of it. */
export type Limit = {
  readonly name: string;
  readonly left: number;
};

/** The usage a provider's script reported, each limit it names and whether any is below the minimum. */
export type Budget = {
  readonly limits: readonly [Limit, ...Limit[]];
  readonly belowMinimum: boolean;
};

/** The state of the progress band, its list null between runs, written only through `step`. */
export type Run = {
  /** The list as the tool that wrote it last keeps it, replaced whole by a call of the other tool, never empty. */
  readonly list: {
    readonly tool: 'TodoWrite' | 'Tasks';
    readonly items: readonly Item[];
  } | null;
  /** Holds the last read's answer of each provider, null before the read and when the provider cannot be read. */
  readonly budgets: Readonly<Record<Provider, Budget | null>>;
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
  | {
      readonly kind: 'usageRead';
      readonly provider: Provider;
      readonly budget: Budget | null;
    }
  | { readonly kind: 'claudeMeasured'; readonly left: number | null };

/** How a part of the line reads, plain for the progress, quiet for the Claude usage and the usage of a provider, alarm below the minimum of the provider. */
export type Tone = 'plain' | 'quiet' | 'alarm';

/** The usage left of a provider under its label, each limit that reported it as a reading such as `5h 62%`, alarm when any limit is below the minimum. */
export type ProviderUsage = {
  readonly label: string;
  readonly readings: readonly [string, ...string[]];
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

/** What the band shows for a run on every surface, before a surface lays it out, any of the Claude usage, the progress and the usages of the providers in the order of `PROVIDERS` but never none. */
export type Band =
  | {
      readonly claude: ClaudeUsage;
      readonly progress: Progress | null;
      readonly usages: readonly ProviderUsage[];
    }
  | {
      readonly claude: null;
      readonly progress: Progress;
      readonly usages: readonly ProviderUsage[];
    }
  | {
      readonly claude: null;
      readonly progress: null;
      readonly usages: readonly [ProviderUsage, ...ProviderUsage[]];
    };

export type Segment = {
  readonly text: string;
  readonly tone: Tone;
};

/** The band's one line as its parts in order, already cut to the band's width. */
export type BandLine = readonly [Segment, ...Segment[]];

export const INITIAL_RUN: Run = {
  list: null,
  budgets: { codex: null, antigravity: null },
  claude: null,
};

/** The fewest columns between the progress and the usages at the right edge. */
const MIN_GAP = 4;

/** The fewest columns the title keeps beside the usages, the ellipsis alone. */
const MIN_TITLE = 1;

/** The columns between two usages at the right edge. */
const USAGE_GAP = 3;

/** How a provider reads on the band and how its script's report turns into a budget. */
const PROVIDER_SPECS: Record<
  Provider,
  { label: string; budgetOf: (report: Report) => Budget | null }
> = {
  codex: { label: 'Codex', budgetOf: codexBudget },
  antigravity: { label: 'Antigravity', budgetOf: antigravityBudget },
};

/** The words of a Gemini group name that say nothing about the model, so `Gemini 4 Argon` shortens to `Argon`. */
const GENERIC_GROUP_WORDS: ReadonlySet<string> = new Set(['gemini', 'models']);

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
    case 'usageRead':
      return {
        ...run,
        budgets: { ...run.budgets, [event.provider]: event.budget },
      };
    case 'claudeMeasured':
      return { ...run, claude: event.left };
    default:
      return unreachable(event);
  }
}

/** Reads what the band shows for the run, null when it has no Claude usage, no list and no usage of a provider. */
export function bandOf(run: Run): Band | null {
  const claude = run.claude === null ? null : { window: `5h ${run.claude}%` };
  const progress = run.list === null ? null : progressOf(run.list);
  const usages = providerUsages(run.budgets);

  if (claude !== null) {
    return { claude, progress, usages };
  }

  if (progress !== null) {
    return { claude: null, progress, usages };
  }

  const [first, ...rest] = usages;

  return first === undefined
    ? null
    : { claude: null, progress: null, usages: [first, ...rest] };
}

/** Lays out the band in characters at the given width, the terminal's one line, the usages of the providers at the right edge and the Claude usage at the left edge, which gives way only once it and the head of the progress no longer fit the columns together. */
export function bandLine(band: Band, columns: number): BandLine {
  if (band.progress === null && band.claude === null) {
    const [first, ...following] = band.usages;

    return usagesAlone(usageText(first), following.map(usageText), columns);
  }

  const usages = band.usages.map(usageText);

  if (band.progress === null) {
    return fitted(claudeText(band.claude, ''), '', usages, columns);
  }

  const head = plain(headOf(band.progress));
  const title = band.progress.title ?? '';
  const claude = band.claude === null ? null : claudeText(band.claude, ' · ');

  if (claude === null || width(claude.text) + width(head.text) > columns) {
    return fitted(head, title, usages, columns);
  }

  return [claude, ...fitted(head, title, usages, columns - width(claude.text))];
}

/** Reads the one JSON line of the `--usage` script of a provider, null when it is no usage report of that provider. */
export function parseUsage(provider: Provider, stdout: string): Budget | null {
  const line = stdout.trim().split('\n').at(-1) ?? '';
  let value: unknown;

  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }

  return isRecord(value) ? PROVIDER_SPECS[provider].budgetOf(value) : null;
}

/** The JSON object of a `--usage` line, whose fields are checked before they are trusted. */
type Report = Record<string, unknown>;

/** Names the 5-hour and the weekly window of a Codex report, `primary` and `secondary`, leaving out a window the report lacks. */
function codexBudget(report: Report): Budget | null {
  const { primary, secondary, belowMinimum } = report;

  if (
    typeof belowMinimum !== 'boolean' ||
    !isPercentOrNull(primary) ||
    !isPercentOrNull(secondary)
  ) {
    return null;
  }

  const [first, ...rest] = [
    { name: '5h', left: primary },
    { name: 'week', left: secondary },
  ].filter((limit): limit is Limit => limit.left !== null);

  return first === undefined
    ? null
    : { limits: [first, ...rest], belowMinimum };
}

/** Names the one group of an Antigravity report `week`, since every group of `/usage` has a weekly limit, and several groups by the short name of the group. */
function antigravityBudget(report: Report): Budget | null {
  const { groups, belowMinimum } = report;

  if (typeof belowMinimum !== 'boolean' || !isRecord(groups)) {
    return null;
  }

  const entries = Object.entries(groups);
  const isOnlyGroup = entries.length === 1;
  const limits = entries.flatMap(([group, left]) =>
    isPercent(left)
      ? [{ name: isOnlyGroup ? 'week' : shortName(group), left }]
      : [],
  );

  const [first, ...rest] = limits;

  return first === undefined || limits.length !== entries.length
    ? null
    : { limits: [first, ...rest], belowMinimum };
}

/** Shortens the name of a Gemini group to the words that tell it from the others, such as `Argon` for `Gemini 4 Argon`, and to `Gemini` when none remain. */
function shortName(group: string): string {
  const words = group
    .split(/\s+/)
    .filter(
      word =>
        !GENERIC_GROUP_WORDS.has(word.toLowerCase()) &&
        !/^\d+(\.\d+)*$/.test(word),
    );

  return words.length === 0 ? 'Gemini' : words.join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPercent(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 100
  );
}

function isPercentOrNull(value: unknown): value is number | null {
  return value === null || isPercent(value);
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

/** Words the usage of each provider that has a budget, in the order of `PROVIDERS`, alarm when any limit has less left than the minimum of the provider. */
function providerUsages(budgets: Run['budgets']): ProviderUsage[] {
  return PROVIDERS.flatMap(provider => {
    const budget = budgets[provider];

    if (budget === null) {
      return [];
    }

    const [first, ...rest] = budget.limits.map(
      ({ name, left }) => `${name} ${left}%`,
    );

    return [
      {
        label: PROVIDER_SPECS[provider].label,
        readings: [first, ...rest],
        tone: budget.belowMinimum ? 'alarm' : 'quiet',
      },
    ];
  });
}

/** Writes the usage as one text, with `(below minimum)` after it in the alarm tone. */
function usageText({ label, readings, tone }: ProviderUsage): Segment {
  const text = `${label} ${readings.join(' · ')}`;

  return tone === 'alarm'
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

/** Cuts the title so head, title, gap and usages fit the columns, and pushes the usages to the right edge, leaving out the last ones first and all of them when the title would vanish. */
function fitted(
  head: Segment,
  title: string,
  usages: readonly Segment[],
  columns: number,
): BandLine {
  const kept = leadingUsages(
    usages,
    columns - width(head.text) - MIN_GAP - MIN_TITLE,
  );

  const room =
    kept.length === 0
      ? columns - width(head.text)
      : columns - width(head.text) - MIN_GAP - usagesWidth(kept);

  const cut =
    width(title) <= Math.max(0, room)
      ? title
      : `${[...title].slice(0, Math.max(0, room - 1)).join('')}…`;

  const progress: Segment = { text: `${head.text}${cut}`, tone: head.tone };

  return [progress, ...atRightEdge(kept, width(progress.text), columns)];
}

/** Lays out the usages with nothing else on the line, as many from the first as fit the columns, and the first at least, which the terminal cuts when it is wider than the band. */
function usagesAlone(
  first: Segment,
  following: readonly Segment[],
  columns: number,
): BandLine {
  const kept = leadingUsages(
    [first, ...following],
    Math.max(columns, width(first.text)),
  );

  const [leading, ...rest] = atRightEdge(kept, 0, columns);

  return [leading, ...rest];
}

/** Keeps the first usages whose width with the gaps between them is at most the limit, so the last ones are left out first. */
function leadingUsages(usages: readonly Segment[], limit: number): Segment[] {
  const kept = [...usages];

  while (kept.length > 0 && usagesWidth(kept) > limit) {
    kept.pop();
  }

  return kept;
}

/** Counts the columns the usages take side by side with the gaps between them. */
function usagesWidth(usages: readonly Segment[]): number {
  const texts = usages.reduce((total, usage) => total + width(usage.text), 0);

  return texts + USAGE_GAP * Math.max(0, usages.length - 1);
}

/** Pads the usages after the columns already taken so they end at the right edge, with no pad where they do not fit, and separates one usage from the next by the gap. */
function atRightEdge(
  usages: readonly Segment[],
  taken: number,
  columns: number,
): Segment[] {
  const pad = Math.max(0, columns - taken - usagesWidth(usages));

  return usages.map((usage, index) => ({
    text: `${' '.repeat(index === 0 ? pad : USAGE_GAP)}${usage.text}`,
    tone: usage.tone,
  }));
}

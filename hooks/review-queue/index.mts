// Lists the open pull requests of the repository in the order to review them, in a pane docked on the right.
// https://code.claude.com/docs/en/plugins/mods/events.md

import type {
  ElementTable,
  Elements,
  EngineInterface,
  Register,
  RenderElement,
  ToolCallResult,
} from 'claude-code';

import {
  PULL_REQUESTS_QUERY,
  headerCaption,
  headerLine,
  paneRows,
  parsePullRequests,
  rowLine,
} from './order.mts';
import type { RepositoryPullRequests } from './order.mts';

const PANE = 'review-queue';

const TITLE = 'Review queue';

/** The repository and its open pull requests as the last refresh left them, null before the first answer and after a failed one, written only by `show`. */
let open: RepositoryPullRequests | null = null;

/** Counts the refreshes started, so an answer that arrives after a newer refresh began is dropped. */
let startedRefreshes = 0;

/** Lets `gh` answer slowly on a large repository, and ends a hung call. */
const FETCH_TIMEOUT_MS = 20_000;

/** Matches the origins of a prompt the person sent, so a task notification never refreshes the pane. */
const PERSON_ORIGINS = [
  { kind: 'composer' },
  { kind: 'bridge' },
  { kind: 'sdk' },
  { kind: 'slack-ping' },
] as const;

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'review-queue',
      description: 'Show the open pull requests in the order to review them',
    });

    void refresh($);

    return next(e);
  });

  on('command.run', { command: 'review-queue' }, async $ => {
    await refresh($);

    return {
      text: hasOpen(open)
        ? 'Review queue pane opened.'
        : 'No open pull requests.',
    };
  });

  // The matcher keeps this hook apart from the progress band's, as a module registers an event without a matcher once.
  on('prompt.submit', { origin: PERSON_ORIGINS }, ($, e, next) => {
    if (e.isMeta !== true) {
      void refresh($);
    }

    return next(e);
  }).catch(($, e, next) => next(e));

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e);

    if (succeeded(ran) && e.command.includes('gh pr ')) {
      void refresh($);
    }

    return ran;
  }).catch(($, e, next) => next(e));

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => {
    if (open === null) {
      return $.ui.resolve(e).Box({ flexDirection: 'column', children: [] });
    }

    // Every other surface has the Box, Text and Link the graphical tree draws with, mobile included.
    return e.surface === 'terminal'
      ? terminalPane($.ui.resolve(e), open, e.props.bodyColumns)
      : graphicalPane($.ui.resolve(e), open);
  });
};

/** Draws the header and one line per row in characters cut to the columns of the pane. */
function terminalPane(
  { Box, Link, Text }: Elements['terminal'],
  open: RepositoryPullRequests,
  columns: number,
): RenderElement {
  const header = headerLine(open, columns);
  const headerRow = Text({
    wrap: 'truncate-end',
    children: [
      Text({
        weight: 'bold',
        children: [
          Link({ href: `${open.repository.url}/pulls`, label: header.label }),
        ],
      }),
      Text({ dimColor: true, children: [header.notes] }),
    ],
  });

  const rows = paneRows(open.pullRequests).map(row => {
    const { lead, label, notes } = rowLine(row, columns);
    const dim =
      notes === '' ? [] : [Text({ dimColor: true, children: [notes] })];

    return Text({
      wrap: 'truncate-end',
      children: [lead, Link({ href: row.url, label }), ...dim],
    });
  });

  return Box({ flexDirection: 'column', children: [headerRow, ...rows] });
}

/** Draws the header and one hoverable row per pull request in boxes that the surface sizes and truncates by its own widths. */
function graphicalPane(
  { Box, Link, Text }: Pick<ElementTable, 'Box' | 'Link' | 'Text'>,
  open: RepositoryPullRequests,
): RenderElement {
  const rows = paneRows(open.pullRequests);
  const positionWidth = String(rows.length).length;

  const header = Box({
    flexDirection: 'column',
    children: [
      Text({
        size: 'heading',
        weight: 'semibold',
        wrap: 'truncate-end',
        children: [
          Link({
            href: `${open.repository.url}/pulls`,
            label: open.repository.name,
          }),
        ],
      }),
      Text({
        size: 'caption',
        dimColor: true,
        children: [headerCaption(open)],
      }),
    ],
  });

  const list = rows.map(row =>
    Box({
      key: `pr-${row.number}`,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 'xs',
      paddingX: 'xs',
      hover: { backgroundColor: 'subtle' },
      children: [
        Box({
          width: positionWidth,
          flexShrink: 0,
          justifyContent: 'flex-end',
          children: [
            Text({
              tabular: true,
              dimColor: true,
              children: [`${row.position}`],
            }),
          ],
        }),
        ...Array.from({ length: row.depth }, () =>
          Text({ color: 'inactive', children: ['│'] }),
        ),
        row.isDraft
          ? Text({ color: 'inactive', children: ['○'] })
          : Text({ color: 'success', children: ['●'] }),
        // A flex item does not shrink below its content without a minimum width, so the title would push the number out instead of truncating.
        // https://developer.mozilla.org/en-US/docs/Web/CSS/min-width#auto
        Box({
          flexGrow: 1,
          minWidth: 0,
          children: [
            Text({
              wrap: 'truncate-end',
              children: [Link({ href: row.url, label: row.title })],
            }),
          ],
        }),
        ...(row.isDraft
          ? [Text({ size: 'caption', dimColor: true, children: ['Draft'] })]
          : []),
        Text({
          size: 'footnote',
          tabular: true,
          dimColor: true,
          children: [`#${row.number}`],
        }),
      ],
    }),
  );

  return Box({
    flexDirection: 'column',
    gap: 'sm',
    children: [header, Box({ flexDirection: 'column', children: list })],
  });
}

/** Lists the open pull requests again and opens the pane for them, or closes it when none is open. */
async function refresh($: EngineInterface): Promise<void> {
  startedRefreshes += 1;

  const thisRefresh = startedRefreshes;
  const answer = await fetchOpenPullRequests($);

  if (thisRefresh !== startedRefreshes) {
    return;
  }

  show($, answer);

  try {
    if (hasOpen(answer)) {
      await $.ui.open({ id: PANE, title: paneTitle(answer) });
    } else {
      await $.ui.close({ id: PANE });
    }
  } catch {
    // A hook that refuses the pane leaves it as it is.
  }
}

/** Sets the repository and the list of the pane, the one writer of them, and draws the pane again. */
function show($: EngineInterface, answer: RepositoryPullRequests | null): void {
  open = answer;
  $.ui.invalidate('ui.render');
}

function hasOpen(
  answer: RepositoryPullRequests | null,
): answer is RepositoryPullRequests {
  return answer !== null && answer.pullRequests.length > 0;
}

/** Names the repository without its owner in the tab, which the engine draws once a second pane is open. */
function paneTitle(answer: RepositoryPullRequests): string {
  const { name } = answer.repository;

  return `${TITLE} · ${name.slice(name.indexOf('/') + 1)}`;
}

/** Asks `gh` for the repository and its open pull requests, null when `gh` is missing, the directory is no GitHub repository or the call fails. */
async function fetchOpenPullRequests(
  $: EngineInterface,
): Promise<RepositoryPullRequests | null> {
  try {
    const { exitCode, stdout } = await $.process.run(
      [
        'gh',
        'api',
        'graphql',
        '-F',
        'owner={owner}',
        '-F',
        'name={repo}',
        '-f',
        `query=${PULL_REQUESTS_QUERY}`,
      ],
      { timeoutMs: FETCH_TIMEOUT_MS },
    );

    return exitCode === 0 ? parsePullRequests(stdout) : null;
  } catch {
    return null;
  }
}

/** Tells a tool's result from a refusal and from an error the tool reported. */
function succeeded<T extends string>(
  ran: ToolCallResult<T>,
): ran is Extract<ToolCallResult<T>, { result: unknown; isError?: undefined }> {
  return ran.deny === undefined && ran.isError !== true;
}

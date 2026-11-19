// Draws the trigger of the prompt optimizer as one glyph at the left end of the row above the prompt, pressed by its key on the terminal and by a click in the apps.
// https://code.claude.com/docs/en/plugins/mods/reference.md

import type { Elements, RenderElement } from 'claude-code';

import type { Phase } from '../../types/index.d.ts';

export type Band = {
  phase: Phase;
  onTrigger: () => Promise<void>;
};

/** What the trigger puts at the left end of the row, with the terminal columns it takes there, the gap to the next part included. */
export type Trigger = {
  parts: RenderElement[];
  columns: number;
};

type AppElements = Pick<Elements['desktop'], 'Button' | 'Progress' | 'Text'>;

const TRIGGER_KEY = 'trigger';
// Borrows the diff panel's action, whose chord does nothing at the prompt while the panel is closed.
const TRIGGER_ACTION = 'app:cycleDiffBase';

/** Cells between two parts of the row. */
export const ROW_GAP = 1;

/** One cell each, so the trigger never changes its width between the phases. */
const GLYPHS: Record<Phase['kind'], string> = {
  idle: '✦',
  optimizing: '■',
  optimized: '↶',
  failed: '✦',
};

/** Names the control where a surface reads it out instead of drawing the glyph. */
const NAMES: Record<Phase['kind'], string> = {
  idle: 'Optimize prompt',
  optimizing: 'Cancel',
  optimized: 'Undo optimize',
  failed: 'Try again',
};

export function terminalTrigger(
  { Button, Text }: Pick<Elements['terminal'], 'Button' | 'Text'>,
  { phase, onTrigger }: Band,
): Trigger {
  const reason = phase.kind === 'failed' ? `failed: ${phase.reason}` : null;
  const failure =
    reason === null ? [] : [Text({ color: 'error', children: [reason] })];

  const button = Button({
    key: TRIGGER_KEY,
    action: TRIGGER_ACTION,
    dimColor: true,
    label: NAMES[phase.kind],
    children: [GLYPHS[phase.kind]],
    onPress: onTrigger,
  });

  const drawn = [
    bracketed(GLYPHS[phase.kind]),
    ...(reason === null ? [] : [reason]),
  ];

  return { parts: [button, ...failure], columns: columnsOf(drawn) };
}

export function appTrigger(
  { Button, Progress, Text }: AppElements,
  { phase, onTrigger }: Band,
): Trigger {
  const progress =
    phase.kind === 'optimizing'
      ? [Progress({ label: 'Optimizing the prompt' })]
      : [];

  const failure =
    phase.kind === 'failed'
      ? [
          Text({
            size: 'footnote',
            color: 'error',
            children: [`Could not optimize: ${phase.reason}`],
          }),
        ]
      : [];

  const button = Button({
    key: TRIGGER_KEY,
    label: NAMES[phase.kind],
    children: [GLYPHS[phase.kind]],
    onPress: onTrigger,
  });

  return { parts: [button, ...progress, ...failure], columns: 0 };
}

/** Writes the label as the terminal draws a Button, in the brackets that stand in for a border, which would take three rows. */
function bracketed(label: string): string {
  return `[ ${label} ]`;
}

/** Counts the cells the texts take side by side, each with the gap of the row after it. */
function columnsOf(texts: readonly string[]): number {
  return texts.reduce((total, text) => total + [...text].length + ROW_GAP, 0);
}

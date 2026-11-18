// Draws the trigger of the prompt optimizer above the prompt, a dim line with its chord on the terminal and a button in the apps.
// https://code.claude.com/docs/en/plugins/mods/reference.md

import type { Elements, RenderElement } from 'claude-code';

import type { Phase } from '../../types/index.d.ts';

export type Band = {
  phase: Phase;
  chord: string;
  onTrigger: () => Promise<void>;
};

type AppElements = Pick<
  Elements['desktop'],
  'Box' | 'Button' | 'Progress' | 'Text'
>;

const TRIGGER_KEY = 'trigger';
// Borrows the diff panel's action, whose chord does nothing at the prompt while the panel is closed.
const TRIGGER_ACTION = 'app:cycleDiffBase';

const TERMINAL_LABELS: Record<Phase['kind'], (chord: string) => string> = {
  idle: chord => `optimize prompt (${chord})`,
  optimizing: chord => `optimizing… (${chord} cancels)`,
  optimized: chord => `undo optimize (${chord})`,
  failed: chord => `optimize prompt (${chord})`,
};

const APP_LABELS: Record<Phase['kind'], string> = {
  idle: 'Optimize prompt',
  optimizing: 'Cancel',
  optimized: 'Undo optimize',
  failed: 'Try again',
};

export function terminalBand(
  { Box, Button, Text }: Elements['terminal'],
  { phase, chord, onTrigger }: Band,
): RenderElement {
  const failure =
    phase.kind === 'failed'
      ? [
          Text({
            dimColor: true,
            color: 'error',
            children: [`optimize failed: ${phase.reason} `],
          }),
        ]
      : [];

  return Box({
    children: [
      ...failure,
      Button({
        key: TRIGGER_KEY,
        action: TRIGGER_ACTION,
        plain: true,
        dimColor: true,
        label: TERMINAL_LABELS[phase.kind](chord),
        onPress: onTrigger,
      }),
    ],
  });
}

export function appBand(
  { Box, Button, Progress, Text }: AppElements,
  { phase, onTrigger }: Band,
): RenderElement {
  const isMainAction = phase.kind === 'idle' || phase.kind === 'failed';
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

  return Box({
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    children: [
      ...progress,
      ...failure,
      Button({
        key: TRIGGER_KEY,
        variant: isMainAction ? 'primary' : 'secondary',
        label: APP_LABELS[phase.kind],
        onPress: onTrigger,
      }),
    ],
  });
}

// Registers the hooks of the progress band and of the prompt optimizer, and joins the two on the events both hook, because a plugin has one hooks module and it takes each event once.
// https://code.claude.com/docs/en/plugins/mods/reference.md

import type { Register } from 'claude-code';

import {
  notePrompt,
  progressBand,
  register as registerProgress,
} from './progress/index.mts';
import { ROW_GAP } from './prompt-optimizer/band.mts';
import {
  forgetRewrite,
  promptOptimizerTrigger,
  register as registerPromptOptimizer,
} from './prompt-optimizer/index.mts';

export const register: Register = (on, options) => {
  registerProgress(on, options);
  registerPromptOptimizer(on, options);

  on('prompt.submit', async ($, e, next) => {
    notePrompt($, e);
    await forgetRewrite($, e);

    return next(e);
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const trigger = await promptOptimizerTrigger($, e);
    const columns = e.props.bodyColumns - (trigger?.columns ?? 0);
    const progress = progressBand($, e, columns);

    if (trigger === null) {
      return progress ?? next(e);
    }

    // One plugin has one row above the prompt, so the trigger stands at its left end and the run takes the rest of it.
    const { Box } = $.ui.resolve(e);
    const rest =
      progress === null
        ? []
        : [
            Box({
              flexDirection: 'column',
              flexGrow: 1,
              minWidth: 0,
              children: [progress],
            }),
          ];

    return Box({
      flexDirection: 'row',
      alignItems: 'center',
      gap: ROW_GAP,
      children: [...trigger.parts, ...rest],
    });
  });
};

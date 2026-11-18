// Registers the hooks of the progress band and of the prompt optimizer, and joins the two on the events both hook, because a plugin has one hooks module and it takes each event once.
// https://code.claude.com/docs/en/plugins/mods/reference.md

import type { Register, RenderElement } from 'claude-code';

import {
  notePrompt,
  progressBand,
  register as registerProgress,
} from './progress/index.mts';
import {
  forgetRewrite,
  promptOptimizerBand,
  register as registerPromptOptimizer,
} from './prompt-optimizer/index.mts';

export const register: Register = (on, options) => {
  const chord = String(options.chord);

  registerProgress(on, options);
  registerPromptOptimizer(on, options);

  on('prompt.submit', async ($, e, next) => {
    notePrompt($, e);
    await forgetRewrite($, e);

    return next(e);
  }).catch(($, e, next) => next(e));

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rows = [
      progressBand($, e),
      await promptOptimizerBand($, e, chord),
    ].filter((row): row is RenderElement => row !== null);

    const [first, second] = rows;

    if (first === undefined) {
      return next(e);
    }

    if (second === undefined) {
      return first;
    }

    // One plugin has one row above the prompt, so the trigger stands under the run, next to the prompt box it acts on.
    const { Box } = $.ui.resolve(e);

    return Box({ flexDirection: 'column', children: [first, second] });
  });
};

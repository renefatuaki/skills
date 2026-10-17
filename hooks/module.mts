// Registers the hooks of every module of the plugin, since Claude Code loads one hooks module per plugin and refuses a second entry under `modules`.
// https://code.claude.com/docs/en/plugins/mods/overview.md

import type { Register } from 'claude-code';

import { register as registerProgress } from './progress/index.mts';
import { register as registerReviewQueue } from './review-queue/index.mts';

export const register: Register = (on, options) => {
  registerProgress(on, options);
  registerReviewQueue(on, options);
};

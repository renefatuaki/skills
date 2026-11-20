#!/usr/bin/env node

// Denies a gh command whose text holds a diagram that draws HTML labels, because no file check ever sees the body of a pull request, an issue or a comment.
// https://code.claude.com/docs/en/hooks.md#pretooluse

import { countHtmlLabelDiagrams, SVG_LABELS } from './lib/diagrams.mts';
import { deny, type HookInput, readHookInput } from './lib/hook.mts';

/** Matches a call of the GitHub CLI anywhere in a shell command. */
const GH_CALL = /(^|[\s;&|(])gh\s/;

main();

function main(): void {
  const { command } = (readHookInput() as HookInput).tool_input ?? {};

  if (typeof command !== 'string' || !GH_CALL.test(command)) {
    return;
  }

  const count = countHtmlLabelDiagrams(command);

  if (count === 0) {
    return;
  }

  deny(
    `This text draws ${count} ${count === 1 ? 'diagram' : 'diagrams'} with HTML labels, which Safari and Chrome cut off. Put ${SVG_LABELS} on the line before the keyword of each flowchart, stateDiagram-v2 and classDiagram, then repeat the command.`,
  );
}

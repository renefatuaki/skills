#!/usr/bin/env node

// Denies a gh command that opens a pull request without the token of the user's GitHub App, because the pull request would then carry the user as its author and the user could not approve it.
// https://code.claude.com/docs/en/hooks.md#pretooluse

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { configDirectory } from '../skills/github/pull-request/scripts/github-app.mts';
import { deny, type HookInput, readHookInput } from './lib/hook.mts';

/** Matches a here-document with its body, which ends at the delimiter alone on a line that only tabs may indent. */
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\t*\2(?=\n|$)/g;

/** Matches the call that opens a pull request, as a command and not inside a quoted text. */
const CREATE_CALL = /(^|[\s;&|(])gh\s+pr\s+create(\s|$)/;

/** Matches an assignment of the token gh authenticates with. */
const TOKEN_ASSIGNMENT = /\bGH_TOKEN=\S/;

const TOKEN_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'skills',
  'github',
  'pull-request',
  'scripts',
  'app-token.mts',
);

main();

function main(): void {
  const { command } = (readHookInput() as HookInput).tool_input ?? {};

  if (typeof command !== 'string') {
    return;
  }

  const shell = command.replace(HEREDOC, '');
  const call = CREATE_CALL.exec(shell);

  if (call === null || TOKEN_ASSIGNMENT.test(shell.slice(0, call.index))) {
    return;
  }

  if (!existsSync(join(configDirectory(process.env), 'github-app.json'))) {
    return;
  }

  deny(
    `This opens the pull request under the user's login, so the user cannot approve it. Open it as the user's GitHub App. Run the pull-request skill, or put GH_TOKEN="$(node ${TOKEN_SCRIPT})" before gh pr create.`,
  );
}

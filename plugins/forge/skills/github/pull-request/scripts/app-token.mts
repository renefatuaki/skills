#!/usr/bin/env node

// Prints an installation token of the user's GitHub App for the repository of the current directory, or with --login the author login gh shows for the app once it is installed there. Prints nothing when no app is configured.

import { parseArgs } from 'node:util';

import { findInstallation } from './github-app.mts';

// https://nodejs.org/api/util.md#utilparseargsconfig
const { values } = parseArgs({
  options: { login: { type: 'boolean', default: false } },
});

try {
  const installation = await findInstallation(process.env);

  if (installation !== null) {
    console.log(
      values.login
        ? `app/${installation.slug}`
        : await installation.createToken(),
    );
  }
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

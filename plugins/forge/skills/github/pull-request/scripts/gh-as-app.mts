#!/usr/bin/env node

// Runs gh with the token of the user's GitHub App for the repository of the current directory, or of the --repo or -R argument gh gets. Runs plain gh when no app is configured. Stdin, stdout, stderr and the exit code pass through.

import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

import { findInstallation } from './github-app.mts';

const ghArguments = process.argv.slice(2);

// Non-strict parsing reads the repository and leaves every other gh option alone.
// https://nodejs.org/api/util.md#utilparseargsconfig
const { values } = parseArgs({
  args: ghArguments,
  options: { repo: { type: 'string', short: 'R' } },
  strict: false,
});

const repository = typeof values.repo === 'string' ? values.repo : undefined;
const env = { ...process.env };

try {
  const installation = await findInstallation(process.env, repository);

  if (installation !== null) {
    env.GH_TOKEN = await installation.createToken();
  }
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const result = spawnSync('gh', ghArguments, { stdio: 'inherit', env });

if (result.error !== undefined) {
  console.error(result.error.message);
}

process.exit(result.status ?? 1);

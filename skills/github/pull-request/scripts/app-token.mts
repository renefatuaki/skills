#!/usr/bin/env node

// Prints an installation token of the user's GitHub App for the repository of the current directory, or with --login the author login gh shows for the app once it is installed there. Prints nothing when no app is configured.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { appJwt, configDirectory, parseAppConfig } from './github-app.mts';

const API = 'https://api.github.com';

// 1. Read the configuration and stop without output when there is none.
// https://nodejs.org/api/util.md#utilparseargsconfig
const { values } = parseArgs({
  options: { login: { type: 'boolean', default: false } },
});

const directory = configDirectory(process.env);
const configPath = join(directory, 'github-app.json');

if (!existsSync(configPath)) {
  process.exit(0);
}

const config = parseAppConfig(readFileSync(configPath, 'utf8'), directory);

if (config === null) {
  fail(`${configPath} needs the fields "clientId" and "privateKey".`);
}

if (!existsSync(config.privateKeyPath)) {
  fail(
    `The private key ${config.privateKeyPath} that ${configPath} names does not exist.`,
  );
}

const jwt = appJwt(
  config.clientId,
  readFileSync(config.privateKeyPath, 'utf8'),
  Math.floor(Date.now() / 1000),
);

// 2. Read the app, whose slug names its login and its installation page.
// https://docs.github.com/en/rest/apps/apps.md#get-the-authenticated-app
const app = await github('GET', '/app');

// 3. Find the installation on this repository, so the login only stands for an app that can open the pull request.
// https://docs.github.com/en/rest/apps/apps.md#get-a-repository-installation-for-the-authenticated-app
const { owner, name } = JSON.parse(
  gh(['repo', 'view', '--json', 'owner,name']),
);

const installation = await github(
  'GET',
  `/repos/${owner.login}/${name}/installation`,
  undefined,
  () =>
    fail(
      `The app ${app.slug} is not installed on ${owner.login}/${name}. Add the repository at https://github.com/apps/${app.slug}/installations/new.`,
    ),
);

if (values.login) {
  console.log(`app/${app.slug}`);
  process.exit(0);
}

// 4. Create a token limited to this repository.
// https://docs.github.com/en/rest/apps/apps.md#create-an-installation-access-token-for-an-app
const access = await github(
  'POST',
  `/app/installations/${installation.id}/access_tokens`,
  { repositories: [name] },
);

console.log(access.token);

/** Calls the REST API as the app and returns the parsed answer, or the result of `onNotFound` when GitHub answers 404. */
async function github(
  method: string,
  path: string,
  body?: object,
  onNotFound?: () => never,
): Promise<Record<string, any>> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${jwt}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 404 && onNotFound !== undefined) {
    onNotFound();
  }

  if (!response.ok) {
    fail(
      `GitHub answered ${response.status} to ${method} ${path}. ${await response.text()}`,
    );
  }

  return response.json();
}

function gh(args: string[]): string {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

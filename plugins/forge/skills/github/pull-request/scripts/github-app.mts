// Reads the configuration of the user's GitHub App, signs the JSON Web Token the app authenticates with and finds its installation on a repository.

import { execFileSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const API = 'https://api.github.com';

/** The GitHub App that opens the pull requests, with the path of its private key resolved. */
export type AppConfig = {
  clientId: string;
  privateKeyPath: string;
};

/** The user's GitHub App installed on one repository. */
export type Installation = {
  /** The slug that names the login of the app, `app/<slug>`. */
  slug: string;
  /** Creates a token that is limited to the repository and lasts an hour. */
  createToken: () => Promise<string>;
};

/** Returns the folder of `github-app.json`, under `$XDG_CONFIG_HOME` when it is set. */
export function configDirectory(env: NodeJS.ProcessEnv): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'forge');
}

/** Reads `github-app.json`, a private key path resolved against its folder and `~/` against the home folder, null when a field is missing. */
export function parseAppConfig(
  text: string,
  directory: string,
): AppConfig | null {
  const value: unknown = JSON.parse(text);

  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const { clientId, privateKey } = value as Record<string, unknown>;

  if (
    typeof clientId !== 'string' ||
    typeof privateKey !== 'string' ||
    clientId === '' ||
    privateKey === ''
  ) {
    return null;
  }

  return { clientId, privateKeyPath: expandPath(privateKey, directory) };
}

/**
 * Signs the token that lasts nine minutes, issued a minute in the past against clock drift.
 * @see {@link https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app.md | GitHub, generating a JWT for a GitHub App}
 */
export function appJwt(
  clientId: string,
  privateKeyPem: string,
  nowSeconds: number,
): string {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + 540,
      iss: clientId,
    }),
  );

  const signature = createSign('RSA-SHA256')
    .update(`${header}.${payload}`)
    .sign(privateKeyPem, 'base64url');

  return `${header}.${payload}.${signature}`;
}

/**
 * Finds the app of `github-app.json` on `repository`, or on the repository of the current directory when none is given. Returns null when no app is configured and throws an error that names the fix when the configuration, the key or the installation is wrong.
 * @see {@link https://docs.github.com/en/rest/apps/apps.md | GitHub, REST API endpoints for GitHub Apps}
 */
export async function findInstallation(
  env: NodeJS.ProcessEnv,
  repository?: string,
): Promise<Installation | null> {
  const directory = configDirectory(env);
  const configPath = join(directory, 'github-app.json');

  if (!existsSync(configPath)) {
    return null;
  }

  const config = parseAppConfig(readFileSync(configPath, 'utf8'), directory);

  if (config === null) {
    throw new Error(
      `${configPath} needs the fields "clientId" and "privateKey".`,
    );
  }

  if (!existsSync(config.privateKeyPath)) {
    throw new Error(
      `The private key ${config.privateKeyPath} that ${configPath} names does not exist.`,
    );
  }

  const jwt = appJwt(
    config.clientId,
    readFileSync(config.privateKeyPath, 'utf8'),
    Math.floor(Date.now() / 1000),
  );

  const app = await callApi(jwt, 'GET', '/app');

  const { owner, name } = JSON.parse(
    execFileSync(
      'gh',
      [
        'repo',
        'view',
        ...(repository === undefined ? [] : [repository]),
        '--json',
        'owner,name',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    ),
  );

  const installation = await callApi(
    jwt,
    'GET',
    `/repos/${owner.login}/${name}/installation`,
    {
      notFound: () =>
        new Error(
          `The app ${app.slug} is not installed on ${owner.login}/${name}. Add the repository at https://github.com/apps/${app.slug}/installations/new.`,
        ),
    },
  );

  return {
    slug: app.slug,
    createToken: async () => {
      const access = await callApi(
        jwt,
        'POST',
        `/app/installations/${installation.id}/access_tokens`,
        { body: { repositories: [name] } },
      );

      return access.token;
    },
  };
}

/** Calls the REST API as the app and returns the parsed answer, or throws the error of `notFound` when GitHub answers 404. */
async function callApi(
  jwt: string,
  method: string,
  path: string,
  { body, notFound }: { body?: object; notFound?: () => Error } = {},
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

  if (response.status === 404 && notFound !== undefined) {
    throw notFound();
  }

  if (!response.ok) {
    throw new Error(
      `GitHub answered ${response.status} to ${method} ${path}. ${await response.text()}`,
    );
  }

  return response.json();
}

function expandPath(path: string, directory: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }

  return isAbsolute(path) ? path : resolve(directory, path);
}

function base64Url(text: string): string {
  return Buffer.from(text).toString('base64url');
}

// Reads the configuration of the user's GitHub App and signs the JSON Web Token the app authenticates with.

import { createSign } from 'node:crypto';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/** The GitHub App that opens the pull requests, with the path of its private key resolved. */
export type AppConfig = {
  clientId: string;
  privateKeyPath: string;
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

function expandPath(path: string, directory: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }

  return isAbsolute(path) ? path : resolve(directory, path);
}

function base64Url(text: string): string {
  return Buffer.from(text).toString('base64url');
}

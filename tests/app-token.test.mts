#!/usr/bin/env node

// Reads configurations of the GitHub App and checks the claims and the signature of the JSON Web Token against a fresh key pair.

import { createVerify, generateKeyPairSync } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  appJwt,
  configDirectory,
  parseAppConfig,
} from '../skills/github/pull-request/scripts/github-app.mts';

let failures = 0;

const CONFIG_CASES: { name: string; text: string; expected: unknown }[] = [
  {
    name: 'a relative key path resolves against the folder of the configuration',
    text: '{ "clientId": "Iv23abc", "privateKey": "github-app.pem" }',
    expected: {
      clientId: 'Iv23abc',
      privateKeyPath: '/config/forge/github-app.pem',
    },
  },
  {
    name: 'a key path with ~/ resolves against the home folder',
    text: '{ "clientId": "Iv23abc", "privateKey": "~/keys/app.pem" }',
    expected: {
      clientId: 'Iv23abc',
      privateKeyPath: join(homedir(), 'keys/app.pem'),
    },
  },
  {
    name: 'an absolute key path stays as it is',
    text: '{ "clientId": "Iv23abc", "privateKey": "/keys/app.pem" }',
    expected: { clientId: 'Iv23abc', privateKeyPath: '/keys/app.pem' },
  },
  {
    name: 'a configuration without a client ID is refused',
    text: '{ "privateKey": "github-app.pem" }',
    expected: null,
  },
  {
    name: 'a configuration with an empty key path is refused',
    text: '{ "clientId": "Iv23abc", "privateKey": "" }',
    expected: null,
  },
];

for (const { name, text, expected } of CONFIG_CASES) {
  failures += report(name, parseAppConfig(text, '/config/forge'), expected);
}

failures += report(
  'the configuration lives under XDG_CONFIG_HOME when it is set',
  configDirectory({ XDG_CONFIG_HOME: '/xdg' }),
  '/xdg/forge',
);

failures += report(
  'the configuration lives under ~/.config otherwise',
  configDirectory({}),
  join(homedir(), '.config/forge'),
);

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

const jwt = appJwt(
  'Iv23abc',
  privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
  1_800_000_000,
);

const [header, payload, signature] = jwt.split('.');

failures += report('the header names RS256', decode(header), {
  alg: 'RS256',
  typ: 'JWT',
});

failures += report(
  'the claims start a minute early and end nine minutes later',
  decode(payload),
  {
    iat: 1_799_999_940,
    exp: 1_800_000_540,
    iss: 'Iv23abc',
  },
);

failures += report(
  'the public key verifies the signature',
  createVerify('RSA-SHA256')
    .update(`${header}.${payload}`)
    .verify(publicKey, signature, 'base64url'),
  true,
);

console.log(failures === 0 ? 'All cases pass.' : `${failures} case(s) failed.`);

process.exit(failures === 0 ? 0 : 1);

function decode(part: string): unknown {
  return JSON.parse(Buffer.from(part, 'base64url').toString());
}

function report(name: string, actual: unknown, expected: unknown): number {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);

  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  if (!ok) {
    console.log(
      `  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`,
    );
  }

  return ok ? 0 : 1;
}

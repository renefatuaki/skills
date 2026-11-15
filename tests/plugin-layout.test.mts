#!/usr/bin/env node

// Fails when a plugin of the marketplace holds another plugin.json below its root, which the Claude cloud refuses to load and `claude plugin validate` does not check.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type Marketplace = { plugins: { name: string; source: string }[] };

const marketplace: Marketplace = JSON.parse(
  readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'),
);

const tracked = execFileSync('git', ['ls-files'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

const errors = marketplace.plugins.flatMap(plugin => {
  const pluginRoot = posix.relative('.', plugin.source);
  const prefix = pluginRoot === '' ? '' : `${pluginRoot}/`;
  const manifest = `${prefix}.claude-plugin/plugin.json`;

  const missing = tracked.includes(manifest)
    ? []
    : [`${plugin.name}: no plugin.json at ${manifest}`];

  const nested = tracked
    .filter(
      path =>
        path.startsWith(prefix) &&
        path.endsWith('.claude-plugin/plugin.json') &&
        path !== manifest,
    )
    .map(
      path =>
        `${plugin.name}: plugin.json must be at .claude-plugin/plugin.json at the plugin root, found nested: '${path}'`,
    );

  return [...missing, ...nested];
});

for (const error of errors) {
  console.error(error);
}

if (errors.length === 0) {
  console.log(
    `every plugin has one plugin.json at its root: ${marketplace.plugins.map(plugin => plugin.name).join(', ')}`,
  );
}

process.exit(errors.length === 0 ? 0 : 1);

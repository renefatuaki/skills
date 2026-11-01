#!/usr/bin/env node

// Copied from mattpocock/skills at commit f3554ac (MIT License, Copyright (c) 2026 Matt Pocock).
// https://github.com/mattpocock/skills/blob/main/scripts/sync-plugin-version.mjs

// Copies the version of each package.json into the plugin.json next to it after `changeset version`, forge at the root and every plugin under plugins/, with --check it only exits 1 on a mismatch.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const plugins = join(repo, 'plugins');

const folders = [
  repo,
  ...readdirSync(plugins, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(plugins, entry.name))
    .filter(folder => existsSync(join(folder, 'package.json'))),
];

let mismatch = false;

for (const folder of folders) {
  mismatch = sync(folder) || mismatch;
}

process.exit(mismatch ? 1 : 0);

/** Brings the plugin.json of one folder to the version of its package.json, and returns whether --check found a mismatch. */
function sync(folder: string): boolean {
  const pluginPath = join(folder, '.claude-plugin', 'plugin.json');
  const name = relative(repo, pluginPath);

  const { version }: { version: string } = JSON.parse(
    readFileSync(join(folder, 'package.json'), 'utf8'),
  );

  const source = readFileSync(pluginPath, 'utf8');
  const plugin: { version: string } = JSON.parse(source);

  if (plugin.version === version) {
    console.log(`${name} version is ${version} (already in sync)`);

    return false;
  }

  if (process.argv.includes('--check')) {
    console.error(
      `${name} version is ${plugin.version}, package.json is ${version}. Run \`node scripts/sync-plugin-version.mts\`.`,
    );

    return true;
  }

  // Rewrite only the version line, to keep the key order and the formatting.
  const updated = source.replace(
    /("version"\s*:\s*")[^"]*(")/,
    `$1${version}$2`,
  );

  if (JSON.parse(updated).version !== version) {
    console.error(
      `Could not find a version field to replace in ${pluginPath}.`,
    );

    process.exit(1);
  }

  writeFileSync(pluginPath, updated);
  console.log(`${name} version ${plugin.version} -> ${version}`);

  return false;
}

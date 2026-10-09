#!/usr/bin/env node

// Adapted from mattpocock/skills at commit f3554ac (MIT License, Copyright (c) 2026 Matt Pocock).
// https://github.com/mattpocock/skills/blob/main/scripts/sync-plugin-version.mjs

// Copies each plugin's package.json version into its plugin.json after `changeset version`, with --check it only exits 1 on a mismatch.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = join(repo, 'plugins');
const check = process.argv.includes('--check');

let mismatches = 0;

for (const name of readdirSync(pluginsDir).sort()) {
  const pluginRoot = join(pluginsDir, name);
  const manifestPath = join(pluginRoot, '.claude-plugin', 'plugin.json');

  const { version }: { version: string } = JSON.parse(
    readFileSync(join(pluginRoot, 'package.json'), 'utf8'),
  );

  const source = readFileSync(manifestPath, 'utf8');
  const manifest: { version: string } = JSON.parse(source);

  if (manifest.version === version) {
    console.log(`${name}: plugin.json version is ${version} (already in sync)`);
    continue;
  }

  if (check) {
    console.error(
      `${name}: plugin.json version is ${manifest.version}, package.json is ${version}. Run \`node scripts/sync-plugin-version.mts\`.`,
    );

    mismatches += 1;
    continue;
  }

  // Rewrite only the version line, to keep the key order and the formatting.
  const updated = source.replace(
    /("version"\s*:\s*")[^"]*(")/,
    `$1${version}$2`,
  );

  if (JSON.parse(updated).version !== version) {
    console.error(
      `${name}: could not find a version field to replace in ${manifestPath}.`,
    );

    process.exit(1);
  }

  writeFileSync(manifestPath, updated);
  console.log(`${name}: plugin.json version ${manifest.version} -> ${version}`);
}

if (mismatches > 0) {
  process.exit(1);
}

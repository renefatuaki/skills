// Ported from scripts/lib/prompts.mjs of the OpenAI Codex plugin for Claude Code 1.0.6 (Apache-2.0 License, Copyright 2026 OpenAI).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Reads the prompt template prompts/<name>.md of the plugin, without the license comment on top. */
export function loadPromptTemplate(rootDir: string, name: string): string {
  return readFileSync(join(rootDir, 'prompts', `${name}.md`), 'utf8').replace(
    /^<!--[\s\S]*?-->\n/,
    '',
  );
}

/** Replaces each {{KEY}} with its value, or with nothing for a key the variables lack. */
export function interpolateTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) =>
    Object.hasOwn(variables, key) ? variables[key] : '',
  );
}

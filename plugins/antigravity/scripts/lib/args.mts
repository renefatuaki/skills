// Ported from scripts/lib/args.mjs of the OpenAI Codex plugin for Claude Code 1.0.6 (Apache-2.0 License, Copyright 2026 OpenAI).

/** Which options take a value, which are switches and which short names stand for another. */
export type ArgsConfig = {
  valueOptions?: string[];
  booleanOptions?: string[];
  aliasMap?: Record<string, string>;
};

/** The options of a command line, a value option as string and a switch as true. */
export type ParsedArgs = {
  options: Record<string, string | boolean | undefined>;
  positionals: string[];
};

/** Splits a command line into its options and positionals. An unknown option stays a positional. */
export function parseArgs(argv: string[], config: ArgsConfig = {}): ParsedArgs {
  const valueOptions = new Set(config.valueOptions ?? []);
  const booleanOptions = new Set(config.booleanOptions ?? []);
  const aliasMap = config.aliasMap ?? {};
  const options: ParsedArgs['options'] = {};
  const positionals: string[] = [];
  let passthrough = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (passthrough) {
      positionals.push(token);
      continue;
    }

    if (token === '--') {
      passthrough = true;
      continue;
    }

    if (!token.startsWith('-') || token === '-') {
      positionals.push(token);
      continue;
    }

    if (token.startsWith('--')) {
      const equals = token.indexOf('=');
      const rawKey = equals === -1 ? token.slice(2) : token.slice(2, equals);
      const inlineValue = equals === -1 ? undefined : token.slice(equals + 1);
      const key = aliasMap[rawKey] ?? rawKey;

      if (booleanOptions.has(key)) {
        options[key] =
          inlineValue === undefined ? true : inlineValue !== 'false';

        continue;
      }

      if (valueOptions.has(key)) {
        const nextValue = inlineValue ?? argv[index + 1];

        if (nextValue === undefined) {
          throw new Error(`Missing value for --${rawKey}`);
        }

        options[key] = nextValue;

        if (inlineValue === undefined) {
          index += 1;
        }

        continue;
      }

      positionals.push(token);
      continue;
    }

    const shortKey = token.slice(1);
    const key = aliasMap[shortKey] ?? shortKey;

    if (booleanOptions.has(key)) {
      options[key] = true;
      continue;
    }

    if (valueOptions.has(key)) {
      const nextValue = argv[index + 1];

      if (nextValue === undefined) {
        throw new Error(`Missing value for -${shortKey}`);
      }

      options[key] = nextValue;
      index += 1;
      continue;
    }

    positionals.push(token);
  }

  return { options, positionals };
}

/** Splits one raw argument string like a shell would, honoring quotes and backslashes. */
export function splitRawArgumentString(raw: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  let escaping = false;

  for (const character of raw) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === '\\') {
      escaping = true;
      continue;
    }

    if (quote !== null) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }

      continue;
    }

    current += character;
  }

  if (escaping) {
    current += '\\';
  }

  if (current !== '') {
    tokens.push(current);
  }

  return tokens;
}

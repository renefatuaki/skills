#!/usr/bin/env node

// Runs the pull request author hook against commands that open a pull request with and without the token of the GitHub App and compares its decision with the expected one.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hooks = join(root, 'plugins', 'forge', 'hooks');
const script = join(hooks, 'check-pull-request-author.mts');

const tokenScript = join(
  root,
  'plugins',
  'forge',
  'skills',
  'github',
  'pull-request',
  'scripts',
  'app-token.mts',
);

const REASON = `This opens the pull request under the user's login, so the user cannot approve it. Open it as the user's GitHub App. Run the pull-request skill, or put GH_TOKEN="$(node ${tokenScript})" before gh pr create.`;

const CASES: {
  name: string;
  command: string;
  app?: boolean;
  expected: string | null;
}[] = [
  {
    name: 'pull request without a token is denied',
    command: 'gh pr create --base dev --title "fix: typo" --body "Fixes it."',
    expected: REASON,
  },
  {
    name: 'pull request in a command substitution without a token is denied',
    command: 'git push -u origin HEAD && url=$(gh pr create --fill)',
    expected: REASON,
  },
  {
    name: 'pull request after the token was unset is denied',
    command: 'unset GH_TOKEN; gh pr create --fill',
    expected: REASON,
  },
  {
    name: 'pull request with the token of the script is silent',
    command: `GH_TOKEN="$(node ${tokenScript})" gh pr create --fill`,
    expected: null,
  },
  {
    name: 'pull request with the token in a variable is silent',
    command: `T=$(node ${tokenScript})\nurl=$(GH_TOKEN="$T" gh pr create --fill)`,
    expected: null,
  },
  {
    name: 'pull request with an exported token is silent',
    command: `export GH_TOKEN="$(node ${tokenScript})" && gh pr create --fill`,
    expected: null,
  },
  {
    name: 'pull request without a token is silent when no app is configured',
    command: 'gh pr create --fill',
    app: false,
    expected: null,
  },
  {
    name: 'issue whose body names the command is silent',
    command: [
      'gh issue create --title "docs: pull requests" --body-file - <<\'EOF\'',
      'Then run',
      'gh pr create --fill',
      'EOF',
    ].join('\n'),
    expected: null,
  },
  {
    name: 'workflow file whose step holds an indented here-document is silent',
    command: [
      "cat >> .github/workflows/release.yml <<'EOF'",
      '        run: |',
      '          body=$(cat <<EOF',
      '          Vendors the tag.',
      '          EOF',
      '          )',
      '          gh pr create --base dev --body "$body"',
      'EOF',
    ].join('\n'),
    expected: null,
  },
  {
    name: 'search for the command is silent',
    command: 'grep -rn "gh pr create" plugins',
    expected: null,
  },
  {
    name: 'edit of a pull request is silent',
    command: 'gh pr edit 12 --add-project "Roadmap"',
    expected: null,
  },
];

const configHome = mkdtempSync(join(tmpdir(), 'forge-author-'));
const emptyHome = mkdtempSync(join(tmpdir(), 'forge-author-'));

mkdirSync(join(configHome, 'forge'));
writeFileSync(
  join(configHome, 'forge', 'github-app.json'),
  JSON.stringify({ clientId: 'Iv1.test', privateKey: 'github-app.pem' }),
);

let failures = 0;

for (const { name, command, app = true, expected } of CASES) {
  const actual = run(command, app ? configHome : emptyHome);
  const passed = actual === expected;

  if (!passed) {
    failures++;
  }

  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);

  if (!passed) {
    console.log(`  expected ${expected ?? 'silence'}`);
    console.log(`  got ${actual ?? 'silence'}`);
  }
}

rmSync(configHome, { recursive: true });
rmSync(emptyHome, { recursive: true });

console.log(failures === 0 ? 'All cases pass.' : `${failures} case(s) failed.`);

process.exit(failures === 0 ? 0 : 1);

/** Feeds one Bash command through the hook as Claude Code would and returns the reason of its denial, or null for silence. */
function run(command: string, xdgConfigHome: string): string | null {
  const result = spawnSync('node', [script], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command },
    }),
    encoding: 'utf8',
    env: { ...process.env, XDG_CONFIG_HOME: xdgConfigHome },
  });

  if (result.status !== 0) {
    return `hook exited with ${result.status}`;
  }

  if (result.stdout.trim() === '') {
    return null;
  }

  const { hookSpecificOutput } = JSON.parse(result.stdout);

  return hookSpecificOutput.permissionDecisionReason;
}

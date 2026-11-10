#!/usr/bin/env node

// Runs the companion against the fake `agy` and compares the arguments it passes, what it prints and the code it exits with with the CLI contract.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  flagValue,
  makeSandbox,
  readCalls,
  readRuns,
  REVIEW_SCHEMA,
  runCompanion,
} from './harness.mts';

const WRITE_SETTINGS = '{"permissions":{"allow":["command(*)"]}}';

describe('task flag sets', () => {
  it('runs read-only without any mode, sandbox or permission flag', () => {
    const sandbox = makeSandbox();
    const result = runCompanion(['task', 'say hello'], sandbox);

    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'answer: say hello\n');

    assert.deepEqual(
      readRuns(sandbox).map(call => call.args),
      [['-p', 'say hello', '--output-format', 'json', '--print-timeout', '8m']],
    );
  });

  it('adds the write-capable flags with --write and lets the run create a file', () => {
    const sandbox = makeSandbox();

    const result = runCompanion(['task', '--write', 'create it'], sandbox, {
      env: { FAKE_AGY_CASE: 'write-run' },
    });

    assert.equal(result.status, 0, result.stdout + result.stderr);

    const [call] = readRuns(sandbox);

    assert.equal(flagValue(call, '--mode'), 'accept-edits');
    assert.ok(call.args.includes('--sandbox'));
    assert.equal(flagValue(call, '--settings'), WRITE_SETTINGS);
    assert.ok(!call.args.includes('--dangerously-skip-permissions'));
    assert.ok(existsSync(join(sandbox.repo, 'created-by-agy.txt')));
    assert.ok(!result.stdout.includes('Notes:'));
  });

  it('keeps a read-only run from writing and shows the soft-denied permissions as notes', () => {
    const sandbox = makeSandbox();

    const result = runCompanion(['task', 'create it'], sandbox, {
      env: { FAKE_AGY_CASE: 'write-run' },
    });

    assert.equal(result.status, 0);
    assert.ok(!existsSync(join(sandbox.repo, 'created-by-agy.txt')));
    assert.match(result.stdout, /Notes:\n- jetski: .*"write_file" permission/);
    assert.match(
      result.stdout,
      /- jetski: the "command" permission was denied/,
    );
  });

  it('never passes --mode auto or the skip-permissions flag in any run', () => {
    const sandbox = makeSandbox(true);

    runCompanion(['task', '--write', 'one'], sandbox);
    runCompanion(['task', 'two'], sandbox);
    runCompanion(['review', '--wait'], sandbox);

    for (const call of readRuns(sandbox)) {
      assert.ok(!call.args.includes('--dangerously-skip-permissions'));
      assert.notEqual(flagValue(call, '--mode'), 'auto');
    }
  });

  it('takes the prompt from --prompt-file and from stdin', () => {
    const sandbox = makeSandbox();
    const promptFile = join(sandbox.root, 'prompt.txt');

    writeFileSync(promptFile, 'prompt from a file');

    runCompanion(['task', '--prompt-file', promptFile], sandbox);
    runCompanion(['task'], sandbox, { input: 'prompt from stdin' });

    assert.deepEqual(
      readRuns(sandbox).map(call => call.args[1]),
      ['prompt from a file', 'prompt from stdin'],
    );
  });

  it('fails without a prompt', () => {
    const sandbox = makeSandbox();
    const result = runCompanion(['task'], sandbox);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Provide a prompt/);
    assert.equal(readRuns(sandbox).length, 0);
  });

  it('prints the payload with --json', () => {
    const sandbox = makeSandbox();
    const result = runCompanion(['task', '--json', 'hi'], sandbox);
    const payload = JSON.parse(result.stdout);

    assert.equal(payload.status, 'completed');
    assert.equal(payload.rawOutput, 'answer: hi');
    assert.equal(payload.conversationId, 'conv-new');
  });

  it('passes --timeout as the print timeout and rejects a bad one', () => {
    const sandbox = makeSandbox();

    runCompanion(['task', '--timeout', '3', 'x'], sandbox);

    assert.equal(flagValue(readRuns(sandbox)[0], '--print-timeout'), '3m');

    const bad = runCompanion(['task', '--timeout', 'soon', 'x'], sandbox);

    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Unsupported timeout/);
  });
});

describe('job log', () => {
  it('logs the command line of the run with the prompt cut to its length', () => {
    const sandbox = makeSandbox();

    runCompanion(['task', '--write', '--model', 'pro', 'a prompt'], sandbox);

    const report = JSON.parse(
      runCompanion(['status', '--json'], sandbox).stdout,
    );

    const log = readFileSync(report.latestFinished.logFile, 'utf8');

    assert.match(
      log,
      /Command: agy -p '<prompt, 8 chars>' --output-format json --model gemini-3\.1-pro-high --mode accept-edits --sandbox --settings '\{"permissions":\{"allow":\["command\(\*\)"\]\}\}' --print-timeout 8m/,
    );
  });
});

describe('model and effort resolution', () => {
  const resolved = (args: string[]) => {
    const sandbox = makeSandbox();
    const result = runCompanion(['task', ...args, 'go'], sandbox);
    const [call] = readRuns(sandbox);

    return { sandbox, result, call };
  };

  it('takes the newest version of the model with the exact effort', () => {
    const { result, call } = resolved(['--model', 'flash', '--effort', 'high']);

    assert.equal(flagValue(call, '--model'), 'gemini-3.10-flash-high');
    assert.ok(!call.args.includes('--effort'));
    assert.ok(!result.stderr.includes('lists no'));
  });

  it('takes the nearest effort of the newest version and notes it on stderr', () => {
    const { result, call } = resolved(['--model', 'flash', '--effort', 'low']);

    assert.equal(flagValue(call, '--model'), 'gemini-3.10-flash-medium');
    assert.ok(!call.args.includes('--effort'));
    assert.match(
      result.stderr,
      /lists no gemini-3\.10-flash with the effort low, so it runs gemini-3\.10-flash-medium/,
    );
  });

  it('targets high without --effort', () => {
    const { call } = resolved(['--model', 'pro']);

    assert.equal(flagValue(call, '--model'), 'gemini-3.1-pro-high');
  });

  it('lets a tie go to the lower effort', () => {
    const { result, call } = resolved(['--model', 'pro', '--effort', 'medium']);

    assert.equal(flagValue(call, '--model'), 'gemini-3.1-pro-low');
    assert.match(result.stderr, /effort medium/);
  });

  it('compares versions part by part', () => {
    const { call } = resolved(['--model', 'argon', '--effort', 'medium']);

    assert.equal(flagValue(call, '--model'), 'gemini-4-argon-medium');
  });

  it('fails for a model the account does not list and names the plan', () => {
    const { result, sandbox } = resolved(['--model', 'carbon']);

    assert.equal(result.status, 1);
    assert.match(
      result.stdout + result.stderr,
      /lists no model named carbon.*plan/,
    );

    assert.equal(readRuns(sandbox).length, 0);
  });

  it('passes a full slug through and ignores --effort with a note', () => {
    const { result, call } = resolved([
      '--model',
      'gemini-3.8-flash-high',
      '--effort',
      'low',
    ]);

    assert.equal(flagValue(call, '--model'), 'gemini-3.8-flash-high');
    assert.ok(!call.args.includes('--effort'));
    assert.match(result.stderr, /carries its effort/);
  });

  it('passes only --effort without a model', () => {
    const { call } = resolved(['--effort', 'xhigh']);

    assert.ok(!call.args.includes('--model'));
    assert.equal(flagValue(call, '--effort'), 'xhigh');
  });

  it('passes neither flag without a model and an effort', () => {
    const { call } = resolved([]);

    assert.ok(!call.args.includes('--model'));
    assert.ok(!call.args.includes('--effort'));
  });

  it('rejects an unknown effort and an unknown model before any run', () => {
    const sandbox = makeSandbox();
    const effort = runCompanion(['task', '--effort', 'turbo', 'x'], sandbox);
    const model = runCompanion(['task', '--model', 'gpt', 'x'], sandbox);

    assert.equal(effort.status, 1);
    assert.match(effort.stderr, /Unsupported effort "turbo"/);
    assert.equal(model.status, 1);
    assert.match(model.stderr, /Unsupported model "gpt"/);
    assert.equal(readCalls(sandbox).length, 0);
  });
});

describe('resuming a conversation', () => {
  it('passes the conversation id of the latest task of this session with --resume-last', () => {
    const sandbox = makeSandbox();
    const env = { ANTIGRAVITY_COMPANION_SESSION_ID: 'session-1' };

    runCompanion(['task', 'first'], sandbox, { env });

    const candidate = runCompanion(
      ['task-resume-candidate', '--json'],
      sandbox,
      { env },
    );

    const parsed = JSON.parse(candidate.stdout);

    assert.equal(parsed.available, true);
    assert.equal(parsed.candidate.conversationId, 'conv-new');

    const resumed = runCompanion(['task', '--resume-last', 'second'], sandbox, {
      env,
    });

    assert.equal(resumed.status, 0);

    const [, second] = readRuns(sandbox);

    assert.equal(flagValue(second, '--conversation'), 'conv-new');
    assert.equal(second.args[1], 'second');
  });

  it('does not see the conversations of another session', () => {
    const sandbox = makeSandbox();

    runCompanion(['task', 'first'], sandbox, {
      env: { ANTIGRAVITY_COMPANION_SESSION_ID: 'session-1' },
    });

    const result = runCompanion(['task', '--resume-last', 'second'], sandbox, {
      env: { ANTIGRAVITY_COMPANION_SESSION_ID: 'session-2' },
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /No previous Antigravity conversation/);
  });

  it('continues with a default prompt when --resume-last has no prompt', () => {
    const sandbox = makeSandbox();

    runCompanion(['task', 'first'], sandbox);
    runCompanion(['task', '--resume-last'], sandbox);

    const [, second] = readRuns(sandbox);

    assert.match(
      second.args[1],
      /^Continue from the current conversation state/,
    );
  });

  it('refuses --resume-last together with --fresh', () => {
    const sandbox = makeSandbox();
    const result = runCompanion(
      ['task', '--resume-last', '--fresh', 'x'],
      sandbox,
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Choose either/);
  });
});

describe('review', () => {
  it('runs read-only with the review schema and renders the structured output', () => {
    const sandbox = makeSandbox(true);
    const result = runCompanion(['review', '--wait'], sandbox);

    assert.equal(result.status, 0, result.stdout + result.stderr);

    const [call] = readRuns(sandbox);

    assert.equal(flagValue(call, '--json-schema'), REVIEW_SCHEMA);
    assert.ok(!call.args.includes('--mode'));
    assert.ok(!call.args.includes('--sandbox'));
    assert.match(call.args[1], /software code review/);
    assert.ok(!call.args[1].includes('<!--'));
    assert.match(call.args[1], /no shell access/);
    assert.match(call.args[1], /\+edited/);
    assert.match(call.args[1], /### notes\.txt/);

    assert.match(
      result.stdout,
      /^# Antigravity Review\n\nTarget: working tree diff\nVerdict: needs-attention/,
    );

    assert.match(
      result.stdout,
      /- \[high\] Error path dropped \(src\/app\.ts:4-6\)/,
    );

    assert.match(result.stdout, /Recommendation: Rethrow the error\./);
    assert.match(result.stdout, /Next steps:\n- Rethrow the error\./);
  });

  it('runs the adversarial prompt with the focus text', () => {
    const sandbox = makeSandbox(true);
    const result = runCompanion(
      ['adversarial-review', '--wait', 'look at', 'retries'],
      sandbox,
    );

    assert.equal(result.status, 0, result.stdout + result.stderr);

    const [call] = readRuns(sandbox);

    assert.match(call.args[1], /adversarial software review/);
    assert.match(call.args[1], /User focus: look at retries/);
    assert.match(result.stdout, /^# Antigravity Adversarial Review/);
  });

  it('rejects focus text for the plain review', () => {
    const sandbox = makeSandbox(true);
    const result = runCompanion(['review', 'be', 'careful'], sandbox);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not support custom focus text/);
    assert.equal(readRuns(sandbox).length, 0);
  });

  it('reviews the branch against --base', () => {
    const sandbox = makeSandbox();
    const result = runCompanion(['review', '--base', 'main'], sandbox);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Target: branch diff against main/);
  });

  it('reads the review from the response when there is no structured output', () => {
    const sandbox = makeSandbox(true);

    const result = runCompanion(['review'], sandbox, {
      env: { FAKE_AGY_CASE: 'review-text' },
    });

    assert.match(result.stdout, /Verdict: needs-attention/);
  });

  it('renders a parse error for a response that is no JSON', () => {
    const sandbox = makeSandbox(true);

    const result = runCompanion(['review'], sandbox, {
      env: { FAKE_AGY_CASE: 'review-bad' },
    });

    assert.match(
      result.stdout,
      /Antigravity did not return valid structured JSON\./,
    );

    assert.match(result.stdout, /This is no JSON\./);
  });

  it('fails a review that the CLI failed', () => {
    const sandbox = makeSandbox(true);

    const result = runCompanion(['review'], sandbox, {
      env: { FAKE_AGY_CASE: 'error' },
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Antigravity review failed\./);
    assert.match(result.stdout, /quota exceeded/);
  });

  it('refuses outside a Git repository', () => {
    const sandbox = makeSandbox();
    const folder = join(sandbox.root, 'plain');

    mkdirSync(folder);

    const result = runCompanion(['review'], sandbox, { cwd: folder });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /must run inside a Git repository/);
  });
});

describe('failures', () => {
  const failing = (kind: string) => {
    const sandbox = makeSandbox();

    return runCompanion(['task', 'go'], sandbox, {
      env: { FAKE_AGY_CASE: kind },
    });
  };

  it('renders an API failure with the error field and the AGY_ERROR line', () => {
    const result = failing('error');

    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /^Antigravity failed with status ERROR and exit code 3\./,
    );

    assert.match(result.stdout, /Error: quota exceeded/);
    assert.match(
      result.stdout,
      /AGY_ERROR: \{"code":"model_api","message":"upstream 503"\}/,
    );
  });

  it('fails when a finished reason is set and keeps the partial response', () => {
    const result = failing('timeout');

    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /Antigravity stopped early with print_timeout\./,
    );

    assert.match(result.stdout, /Half an answer\./);
  });

  it('fails when the status is not SUCCESS', () => {
    const result = failing('canceled');

    assert.equal(result.status, 1);
    assert.match(result.stdout, /status CANCELED/);
  });

  it('fails on an empty response', () => {
    const result = failing('empty');

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Antigravity answered nothing\./);
  });

  it('fails when the output is no JSON and shows the stderr line', () => {
    const result = failing('noise');

    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /exited with code 1 and printed no JSON answer/,
    );

    assert.match(result.stdout, /panic: agy lost its connection/);
  });

  it('fails with the install page when agy is missing', () => {
    const sandbox = makeSandbox();

    const result = runCompanion(['task', 'go'], sandbox, {
      env: { PATH: '/usr/bin:/bin' },
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /`agy` is not installed.*antigravity\.google/);
  });

  it('records a failed run as a failed job', () => {
    const sandbox = makeSandbox();

    runCompanion(['task', 'go'], sandbox, { env: { FAKE_AGY_CASE: 'error' } });

    const status = runCompanion(['status', '--json'], sandbox);
    const report = JSON.parse(status.stdout);

    assert.equal(report.latestFinished.status, 'failed');
    assert.match(
      report.latestFinished.summary,
      /Antigravity failed with status ERROR/,
    );

    const result = runCompanion(['result'], sandbox);

    assert.match(result.stdout, /Error: quota exceeded/);
  });
});

describe('read-only guard', () => {
  it('fails a read-only run that changed a file', () => {
    const sandbox = makeSandbox();

    const result = runCompanion(['task', 'go'], sandbox, {
      env: { FAKE_AGY_CASE: 'writes' },
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /^Antigravity changed files: written\.txt/);
  });

  it('fails a review that changed a file', () => {
    const sandbox = makeSandbox(true);

    const result = runCompanion(['review'], sandbox, {
      env: { FAKE_AGY_CASE: 'writes' },
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Antigravity changed files: written\.txt/);
  });

  it('fails when the run edited a file that was already dirty', () => {
    const sandbox = makeSandbox(true);

    const result = runCompanion(['task', 'go'], sandbox, {
      env: { FAKE_AGY_CASE: 'writes' },
    });

    assert.match(result.stdout, /changed files: written\.txt/);
    assert.ok(!result.stdout.includes('notes.txt'));
  });

  it('lets a write-capable run change files', () => {
    const sandbox = makeSandbox();

    const result = runCompanion(['task', '--write', 'go'], sandbox, {
      env: { FAKE_AGY_CASE: 'writes' },
    });

    assert.equal(result.status, 0);
  });

  it('passes a read-only run that changed nothing', () => {
    const sandbox = makeSandbox(true);
    const result = runCompanion(['task', 'go'], sandbox);

    assert.equal(result.status, 0);
  });

  it('ignores the state folder when it lies inside the work tree', () => {
    const sandbox = makeSandbox();

    const result = runCompanion(['task', 'go'], sandbox, {
      env: { ANTIGRAVITY_COMPANION_DATA: join(sandbox.repo, '.plugin-data') },
    });

    assert.equal(result.status, 0, result.stdout);
  });

  it('keeps its state out of the data folder of another plugin', () => {
    const sandbox = makeSandbox();
    const foreign = join(sandbox.root, 'codex-openai-codex');

    const result = runCompanion(['task', 'go'], sandbox, {
      env: { CLAUDE_PLUGIN_DATA: foreign },
    });

    assert.equal(result.status, 0, result.stdout);
    assert.equal(existsSync(foreign), false);
  });
});

describe('setup', () => {
  it('reports a ready setup with the models and the usage groups', () => {
    const sandbox = makeSandbox();
    const result = runCompanion(['setup'], sandbox);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /^# Antigravity Setup\n\nStatus: ready/);
    assert.match(result.stdout, /- agy: 1\.4\.99/);
    assert.match(result.stdout, /- auth: signed in, 15 model\(s\) listed/);
    assert.match(result.stdout, /- models: gemini-4-argon-high, /);
    assert.match(result.stdout, /- usage, Gemini Models: weekly 92% left/);
    assert.match(result.stdout, /- review gate: disabled/);
  });

  it('prints the report as JSON', () => {
    const sandbox = makeSandbox();
    const report = JSON.parse(
      runCompanion(['setup', '--json'], sandbox).stdout,
    );

    assert.equal(report.ready, true);
    assert.equal(report.agy.available, true);
    assert.equal(report.auth.loggedIn, true);
    assert.equal(report.usage.groups[0].name, 'Gemini Models');
    assert.equal(report.reviewGateEnabled, false);
  });

  it('points to `!agy` when the account is signed out', () => {
    const sandbox = makeSandbox();

    const result = runCompanion(['setup'], sandbox, {
      env: { FAKE_AGY_CASE: 'signed-out' },
    });

    assert.match(result.stdout, /Status: needs attention/);
    assert.match(result.stdout, /- auth: not signed in/);
    assert.match(result.stdout, /Run `!agy` to sign in interactively\./);
  });

  it('points to the install page when agy is missing', () => {
    const sandbox = makeSandbox();

    const result = runCompanion(['setup'], sandbox, {
      env: { PATH: '/usr/bin:/bin' },
    });

    assert.match(result.stdout, /Status: needs attention/);
    assert.match(
      result.stdout,
      /Install the Antigravity CLI from https:\/\/antigravity\.google\//,
    );
  });

  it('turns the review gate on and off', () => {
    const sandbox = makeSandbox();

    const enabled = runCompanion(['setup', '--enable-review-gate'], sandbox);

    assert.match(enabled.stdout, /Enabled the stop-time review gate/);
    assert.match(enabled.stdout, /- review gate: enabled/);

    const disabled = runCompanion(['setup', '--disable-review-gate'], sandbox);

    assert.match(disabled.stdout, /- review gate: disabled/);

    const both = runCompanion(
      ['setup', '--enable-review-gate', '--disable-review-gate'],
      sandbox,
    );

    assert.equal(both.status, 1);
  });
});

describe('usage', () => {
  it('prints the subcommands and fails on an unknown one', () => {
    const sandbox = makeSandbox();

    assert.match(runCompanion(['help'], sandbox).stdout, /adversarial-review/);
    assert.ok(!runCompanion(['help'], sandbox).stdout.includes('transfer'));

    const unknown = runCompanion(['transfer'], sandbox);

    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Unknown subcommand: transfer/);
  });
});

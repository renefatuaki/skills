#!/usr/bin/env node

// Runs the comment check hook over every fixture and compares the findings with the expected ones.

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "hooks", "check-comments.mjs");
const fixtures = join(root, "tests", "fixtures");

const EXPECTED = {
  "bad.swift": ["3 em-dash", "6 semicolon", "9 too-long", "14 todo-link"],
  "good.swift": [],
  "bad.py": ["3 em-dash", "7 semicolon", "10 too-long", "16 todo-link"],
  "good.py": [],
  "bad.ts": ["3 em-dash", "6 semicolon", "10 too-long", "16 todo-link"],
  "good.ts": [],
  "bad.kt": ["3 em-dash", "6 semicolon", "10 too-long", "16 todo-link"],
  "good.kt": [],
  "bad.java": ["3 em-dash", "6 semicolon", "10 too-long", "16 todo-link"],
  "good.java": [],
  "notes.md": [],
  "missing.swift": [],
};

let failures = 0;
for (const [name, expected] of Object.entries(EXPECTED)) {
  const actual = run(join(fixtures, name));
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) console.log(`  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
}
console.log(failures === 0 ? "All fixtures pass." : `${failures} fixture(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

// Feeds one fixture through the hook as Claude Code would and returns "line rule" pairs.
function run(filePath) {
  const input = JSON.stringify({ cwd: root, hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: filePath } });
  const result = spawnSync("node", [script], { input, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`hook exited with ${result.status}: ${result.stderr}`);
  if (result.stdout.trim() === "") return [];
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  return context
    .split("\n")
    .slice(1)
    .map((line) => line.match(/:(\d+) (\S+) /))
    .filter(Boolean)
    .map((m) => `${m[1]} ${m[2]}`);
}

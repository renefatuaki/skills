// Ported from scripts/lib/workspace.mjs of the OpenAI Codex plugin for Claude Code 1.0.6 (Apache-2.0 License, Copyright 2026 OpenAI).

import { ensureGitRepository } from './git.mts';

/** Resolves the root of the Git work tree of a folder, or the folder itself outside a work tree. */
export function resolveWorkspaceRoot(cwd: string): string {
  try {
    return ensureGitRepository(cwd);
  } catch {
    return cwd;
  }
}

// Declares the values the hooks modules of this plugin keep in the session, which `claude plugin validate` holds every `$.state` key to.
// https://code.claude.com/docs/en/plugins/mods/reference.md

/** Where the prompt optimizer stands with the draft, from no run through a running rewrite to a rewrite it can undo or a failure it shows. */
export type Phase =
  | { kind: 'idle' }
  | { kind: 'optimizing'; original: string; startedAt: number }
  | { kind: 'optimized'; original: string; rewritten: string }
  | { kind: 'failed'; reason: string };

declare module 'claude-code' {
  interface PluginState {
    forge: { phase: Phase; hasDraft: boolean };
  }
}

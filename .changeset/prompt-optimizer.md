---
"forge": minor
---

`ctrl+x b` at the prompt rewrites the unsent draft in the prompt box into a clearer prompt for the same request. A Claude model writes it by Anthropic's current prompting guidance, with the session in view, and the key never sends the prompt. The same key cancels a running rewrite or brings the draft back. On the terminal the band above the prompt names the key once the prompt box holds a draft. The desktop app and mobile draw a button. The key is the one bound to `app:cycleDiffBase`. To move it, bind that action in the `Global` context of `~/.claude/keybindings.json` and set **Chord of the prompt optimizer** in `/config` to the new name. `plugins/forge/hooks/prompt-optimizer/README.md` shows the steps and the limits.

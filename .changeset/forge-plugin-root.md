---
"forge": patch
---

forge loads in Claude cloud sessions again. Its plugin root moved from the repository root to `plugins/forge`, so the antigravity plugin no longer lies inside it. The cloud refused forge before with "plugin.json must be at .claude-plugin/plugin.json at the plugin root". A local install picks up the new source after `/plugin marketplace update renefatuaki`.

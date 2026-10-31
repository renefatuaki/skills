---
description: Check whether the local Antigravity CLI is ready and optionally toggle the stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*), Bash(curl -fsSL https://antigravity.google/cli/install.sh:*), Bash(bash), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mts" setup --json $ARGUMENTS
```

If the result says Antigravity is unavailable and the platform is macOS or Linux:
- Use `AskUserQuestion` exactly once to ask whether Claude should install Antigravity now.
- Put the install option first and suffix it with `(Recommended)`.
- Use these two options:
  - `Install Antigravity (Recommended)`
  - `Skip for now`
- If the user chooses install, run the official installer from the [Antigravity quickstart](https://antigravity.google/docs/getting-started?tab=cli):

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

- Then rerun:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mts" setup --json $ARGUMENTS
```

If Antigravity is already installed or the platform is Windows:
- Do not ask about installation.

Output rules:
- Present the final setup output to the user.
- If installation was skipped, present the original setup output.
- If Antigravity is installed but not signed in, preserve the guidance to run `!agy`.

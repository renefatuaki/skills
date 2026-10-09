---
name: package-manager
description: package-manager, which JavaScript package manager a repository uses and its commands. Use before installing a dependency, running a one-off tool with npx, pnpx, yarn dlx or bunx, or when another skill needs the repository's package manager.
---

The lockfile in the repository root decides. Read the row that matches and use its commands.

| Lockfile | Install all | Add dev dependency | Run a one-off tool |
|---|---|---|---|
| `pnpm-lock.yaml` | `pnpm install` | `pnpm add -D <package>` | `pnpx <command>` |
| `package-lock.json` | `npm install` | `npm install -D <package>` | `npx <command>` |
| `yarn.lock` | `yarn install` | `yarn add -D <package>` | `yarn dlx <command>` |
| `bun.lock` or `bun.lockb` | `bun install` | `bun add -d <package>` | `bunx <command>` |

No lockfile: the `pnpm` row. Two lockfiles: ask which one the project keeps.

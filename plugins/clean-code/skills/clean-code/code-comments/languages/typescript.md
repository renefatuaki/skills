# TypeScript and JavaScript

Doc comments use TSDoc or JSDoc: `/** ... */`. VS Code renders them in the hover at every call site and in IntelliSense. Plain URLs in any comment are Ctrl/Cmd-clickable in the editor.

## Summary line

The summary is the text before any block tag. One sentence, verb first, period. Without a link keep the whole block on one line. Types live in the signature, so names carry the parameters.

```ts
/** Returns the cart total in cents, including tax. */
export function cartTotal(cart: Cart): number
```

## Link line

Doc comment: `@see` with an inline `{@link}` on its own `*` line. TypeScript resolves `{@link}` in hovers and VS Code renders the URL clickable.

```ts
/**
 * Revalidates the cached page at most once per minute.
 * @see {@link https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#revalidate | Route segment config}
 */
export const revalidate = 60
```

Step comment inside a body: numbered steps, the bare URL on its own unnumbered `//` line right under the step.

```ts
async function sync(): Promise<void> {
  // 1. Resolve the token first so a retry never races the storage read.
  const token = await tokenStore.current()
  // 2. Ask the server for a delta instead of a full sync.
  // https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
  const changes = await api.changes({ since: cursor, token })
  // 3. Apply the delta in one transaction so a reload never shows half a sync.
  await db.transaction(() => store.apply(changes))
}
```

## React and Next.js

A component whose name says what it renders needs no doc line. Document a component only when it owns non-obvious state or effects, and link the API when you explain an effect (`useEffect` cleanup, `useSyncExternalStore`). Next.js route segment config exports (`revalidate`, `dynamic`) get a link line, their meaning is not visible from the code.

## Before and after

Before:

```ts
/**
 * Fetches the user — also caches it; see docs
 * @param id the user id
 * @returns the user
 */
export async function fetchUser(id: UserId): Promise<User>
```

After:

```ts
/** Fetches the user and caches the result for the session. */
export async function fetchUser(id: UserId): Promise<User>
```

Before:

```ts
/** Returns the count. */
export const count = 0
```

After:

```ts
export const count = 0
```

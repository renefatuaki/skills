# Kotlin

Doc comments use KDoc: `/** ... */`. IntelliJ and Android Studio render them as Markdown in Quick Documentation and in the hover at every call site. Plain URLs in any comment are Ctrl-clickable in the editor.

## Summary line

The first paragraph is the summary. One sentence fragment, verb first, period. Without a link keep the whole KDoc on one line. Name parameters inline in backticks, which the Kotlin coding conventions prefer over `@param`.

```kotlin
/** Returns the user for `id`, or null once the cache has expired. */
fun cachedUser(id: UserId): User?
```

## Link line

Doc comment: a Markdown link on its own `*` line. Renders clickable in Quick Documentation and hover.

```kotlin
/**
 * Collects the flow only while the lifecycle is at least STARTED.
 * [repeatOnLifecycle](https://developer.android.com/topic/libraries/architecture/coroutines#restart-lifecycle)
 */
fun observeUser()
```

Step comment inside a body: numbered steps, the bare URL on its own unnumbered `//` line right under the step.

```kotlin
suspend fun sync() {
    // 1. Resolve the token first so a retry never races the keystore.
    val token = tokenStore.current()
    // 2. Ask the server for a delta instead of a full sync.
    // https://developer.android.com/training/data-storage/room/async-queries
    val changes = api.changes(since = cursor, token = token)
    // 3. Apply the delta in one transaction so a crash never leaves half a sync on disk.
    db.withTransaction { store.apply(changes) }
}
```

## Android and Compose

Follow the Android Kotlin style guide for KDoc. A `@Composable` whose name says what it draws needs no doc line. Document a composable only when it hoists non-obvious state or runs side effects (`LaunchedEffect`, `DisposableEffect`), and link the effect API when you explain it.

## Before and after

Before:

```kotlin
/**
 * Fetches the user — also caches it; see docs
 * @param id the user id
 * @return the user
 */
suspend fun fetchUser(id: UserId): User
```

After:

```kotlin
/** Fetches the user for `id` and caches the result for the session. */
suspend fun fetchUser(id: UserId): User
```

Before:

```kotlin
/** Returns the count. */
val count: Int
```

After:

```kotlin
val count: Int
```

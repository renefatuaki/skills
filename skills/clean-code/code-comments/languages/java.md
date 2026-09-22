# Java

Doc comments use Javadoc: `/** ... */`. IntelliJ renders them in Quick Documentation and in the hover at every call site. Plain URLs in any comment are Ctrl-clickable in the editor.

## Summary line

The first sentence is the summary. Write a summary fragment as in the Google Java style: verb first, period, never "This method returns". Without a link keep the whole Javadoc on one line.

```java
/** Returns the customer ID, or null when the session is anonymous. */
String customerId()
```

## Link line

Doc comment: `@see` with an HTML anchor on its own `*` line. Javadoc and IntelliJ render it as a clickable link. `{@link}` only takes code references, so it cannot carry a URL. On JDK 23+ projects that already use `///` Markdown doc comments, write `[Label](url)` instead of the anchor.

```java
/**
 * Retries idempotent requests with exponential backoff.
 * @see <a href="https://docs.spring.io/spring-framework/reference/integration/rest-clients.html">Spring REST clients</a>
 */
Response send(Request request)
```

Step comment inside a body: numbered steps, the bare URL on its own unnumbered `//` line right under the step.

```java
void sync() {
    // 1. Resolve the token first so a retry never races the credential store.
    var token = tokenStore.current();
    // 2. Ask the server for a delta instead of a full sync.
    // https://docs.spring.io/spring-framework/reference/integration/rest-clients.html#rest-restclient
    var changes = api.changes(cursor, token);
    // 3. Apply the delta in one transaction so a crash never leaves half a sync on disk.
    transactions.execute(status -> store.apply(changes));
}
```

## Spring

Spring's own code style asks for an imperative first sentence ("Return", not "Returns"). Follow whichever form the project already uses.

## Before and after

Before:

```java
/**
 * Fetches the user — also caches it; see docs
 * @param id the user id
 * @return the user
 */
User fetchUser(UserId id)
```

After:

```java
/** Fetches the user and caches the result for the session. */
User fetchUser(UserId id)
```

Before:

```java
/** Returns the count. */
int count()
```

After:

```java
int count()
```

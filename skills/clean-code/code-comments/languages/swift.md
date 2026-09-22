# Swift

Doc comments use `///`. Xcode renders them as Markdown in Quick Help (Option-click) and in the hover at every call site. In the source editor they stay raw text, so a bare URL is the only link that is clickable in place.

## Summary line

Sentence fragment, verb first, ends with a period. No symbol names or links in it, because DocC takes this line as the summary (Swift API Design Guidelines).

```swift
/// Inserts the item at the head of the list.
func prepend(_ item: Element)
```

## Link line

Doc comment: a Markdown link on its own `///` line. Quick Help renders it clickable at every call site.

```swift
/// Waits for connectivity instead of failing the request immediately.
/// [waitsForConnectivity](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/waitsforconnectivity)
func makeSession() -> URLSession
```

Step comment inside a body: numbered steps, the bare URL on its own unnumbered `//` line right under the step.

```swift
func sync() async throws {
    // 1. Resolve the token first so a retry never races the keychain.
    let token = try await tokenStore.current()
    // 2. Ask the server for a delta instead of a full sync.
    // https://developer.apple.com/documentation/cloudkit/ckfetchrecordzonechangesoperation
    let changes = try await fetchChanges(since: cursor, token: token)
    // 3. Apply the delta in one transaction so a crash never leaves half a sync on disk.
    try store.apply(changes)
}
```

## MARK

Add `// MARK: -` groups when a type holds two or more of the groups below. Use the names as written, keep the order, one blank line above each MARK. The dash draws a separator in the Xcode jump bar, `// MARK:` without a dash is a sub-heading inside a group.

| Group | Holds |
|---|---|
| `// MARK: - Types` | Nested types, enums, type aliases. |
| `// MARK: - Constants` | Static lets and magic numbers. |
| `// MARK: - Properties` | Stored and computed properties, outlets, SwiftUI state and environment values. Split into `Public Properties` and `Private Properties` when both exist. |
| `// MARK: - Initialization` | `init`, `deinit`, factory methods. |
| `// MARK: - Lifecycle` | `viewDidLoad`, `viewWillAppear`, `onAppear`, scene and app lifecycle callbacks. |
| `// MARK: - Body` | The SwiftUI `body` property. |
| `// MARK: - Subviews` | Private view builders and child views a SwiftUI body composes. |
| `// MARK: - Setup` | View hierarchy, constraints, configuration run once. |
| `// MARK: - Actions` | `@IBAction`, button handlers, user intents. |
| `// MARK: - Public Methods` | The type's API. |
| `// MARK: - Private Methods` | Helpers. `Helpers` is an accepted alias. |
| `// MARK: - Networking` | Requests, decoding, API calls. |
| `// MARK: - Navigation` | Routing, presenting, segues. |
| `// MARK: - Notifications` | Observers, Combine subscriptions, notification handlers. |
| `// MARK: - Errors` | Error types and mapping. |
| `// MARK: - <ProtocolName>` | One group per protocol conformance, named after the protocol, usually in its own `extension`. |
| `// MARK: - Preview` | `#Preview` and preview providers. |

Test files use `// MARK: - Setup`, `// MARK: - Tests`, `// MARK: - Helpers`.

```swift
final class ProfileViewController: UIViewController {

    // MARK: - Properties

    private let store: ProfileStore

    // MARK: - Initialization

    init(store: ProfileStore) { ... }

    // MARK: - Lifecycle

    override func viewDidLoad() { ... }

    // MARK: - Actions

    @objc private func didTapSave() { ... }
}

// MARK: - UITableViewDataSource

extension ProfileViewController: UITableViewDataSource { ... }
```

## SwiftUI

A `View` whose name says what it shows needs no doc line. Document a view only when it owns non-obvious state or a workflow, and apply the step-comment test to `body` like to any function. Modifier chains speak for themselves.

## Before and after

Before:

```swift
// This function fetches the user — it also caches; see docs
func fetchUser() async throws -> User
```

After:

```swift
/// Fetches the user and caches the result for the session.
func fetchUser() async throws -> User
```

Before:

```swift
/// Returns the count.
var count: Int
```

After:

```swift
var count: Int
```

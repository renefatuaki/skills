# Swift

Idioms for the rules in [../SKILL.md](../SKILL.md). Follow the project's existing choices where they differ.

## Naming

Types `UpperCamelCase`, everything else `lowerCamelCase`. Booleans read as assertions: `isEmpty`, `hasChanges`, `canSend`. Methods with side effects are verbs, `sort()`, their non-mutating twin takes the `-ed` or `-ing` form, `sorted()`. Argument labels make the call site read as a sentence, `move(from: a, to: b)`, so a parameter container is rarer here than in other languages.

- [Swift API Design Guidelines](https://www.swift.org/documentation/api-design-guidelines/)

## Guards and errors

The guard idiom is the `guard` statement, one per precondition or combined, exiting with `return` or `throw`.

```swift
func messageUser(_ user: User?, _ message: String?) {
  guard let user, let message, user.acceptsMessages else { return }

  user.send(message)
}
```

Real errors are `throws` with an `Error` enum, or `Result` where the project already returns results. A returned status code or optional-as-error is synthetic.

```swift
enum SignUpError: Error {
  case invalidInput
  case emailTaken
}

func validateInput(email: String, password: String) throws {
  guard email.contains("@"), password.count >= 8 else {
    throw SignUpError.invalidInput
  }

  guard !userExists(email) else { throw SignUpError.emailTaken }
}
```

## Parameter objects and data containers

A data container is a `struct` with `let` or `var` stored properties and no behaviour beyond computed properties. A real object is a `final class` or a `struct` with private storage and public methods. Group related parameters into a `struct`.

```swift
struct Rectangle {
  let x: Int
  let y: Int
  let width: Int
  let height: Int
}

func draw(_ rectangle: Rectangle)
```

## Polymorphism

A `protocol` with one conformance per variant replaces a `switch` on a type field that repeats across methods. Keep the `switch` in one factory that returns the protocol type.

```swift
protocol Delivery {
  func deliver()
  func track()
}

func makeDelivery(for purchase: Purchase) -> Delivery {
  switch purchase.kind {
  case .express: ExpressDelivery(purchase)
  case .insured: InsuredDelivery(purchase)
  case .standard: StandardDelivery(purchase)
  }
}
```

An `enum` with associated values and one exhaustive `switch` is the right choice when the variants are closed and the behaviour lives in one place. Reach for the protocol when the same `switch` appears in several methods.

## Explicit over compact

The constructs that tempt: `$0` in a closure longer than one line, `map` and `compactMap` chains that do several things per step, nested ternaries, `??` chains that hide which fallback fires, and `flatMap` on optionals where `if let` reads as a sentence.

Before:

```swift
let label =
  user.map { $0.isAdmin ? "Admin" : ($0.isGuest ? "Guest" : "Member") }
  ?? "Anonymous"
```

After:

```swift
func roleLabel(for user: User?) -> String {
  guard let user else { return "Anonymous" }
  if user.isAdmin { return "Admin" }
  if user.isGuest { return "Guest" }

  return "Member"
}
```

Before:

```swift
let total = items.filter { $0.isActive }.reduce(0) {
  $0 + $1.price * $1.quantity
}
```

After:

```swift
let activeItems = items.filter { $0.isActive }
let total = activeItems.reduce(0) { sum, item in
  sum + item.price * item.quantity
}
```

`$0` stays in a one-line closure with one obvious subject. Two positional parameters, or a body with more than one expression, get names.

## Formatting

swift-format 6.2 or newer formats and lints. It ships with Xcode 26 and the Swift 6.2 toolchain, so run `swift format --version` first and stop with the version when it is older, the configuration carries comments only 6.2 reads. If the project has no `.swift-format`, copy [.swift-format](../formatting/swift/.swift-format) into the project root after confirmation. SwiftLint adds the one blank-line rule swift-format lacks, install it after confirmation with `brew install swiftlint` and copy [.swiftlint.yml](../formatting/swift/.swiftlint.yml) next to it. A project that already runs SwiftFormat switches to swift-format, its configuration file and build phase are removed after confirmation.

```sh
swift format --in-place --recursive .
swift format lint --strict --recursive .
swiftlint lint --strict
```

After every edit run the format command, then both lint commands, on the touched files.

- [swift-format](https://github.com/swiftlang/swift-format)
- [swift-format rules](https://github.com/swiftlang/swift-format/blob/main/Documentation/RuleDocumentation.md)
- [SwiftLint](https://github.com/realm/SwiftLint)

## Ordering

Inside a type, keep the `// MARK: -` groups from the code-comments skill. Within a group, public members first in call order, then private helpers in call order.

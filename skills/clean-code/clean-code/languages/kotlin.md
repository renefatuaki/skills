# Kotlin

Idioms for the rules in [../SKILL.md](../SKILL.md). Follow the project's existing choices where they differ.

## Naming

Classes `UpperCamelCase`, functions and properties `lowerCamelCase`, constants `SCREAMING_SNAKE_CASE`. Booleans read as questions, `isEnabled`, `hasItems`. Functions that return a value and do no work read as properties, so a getter with no side effect is a `val`, not a `fun getX()`.

- [Kotlin Coding Conventions](https://kotlinlang.org/docs/coding-conventions.html)

## Guards and errors

Guards are early `return`, or `require`, `check` and `requireNotNull` when the failed precondition is a caller bug.

```kotlin
fun messageUser(user: User?, message: String?) {
    if (user == null || message == null || !user.acceptsMessages) return
    user.send(message)
}
```

Real errors are exceptions, or a `sealed` result type or `Result` where the project already returns results. A returned code or nullable-as-error is synthetic.

```kotlin
sealed class SignUpError : Exception() {
    object InvalidInput : SignUpError()
    object EmailTaken : SignUpError()
}

fun validateInput(email: String, password: String) {
    if ("@" !in email || password.length < 8) throw SignUpError.InvalidInput
    if (userExists(email)) throw SignUpError.EmailTaken
}
```

## Parameter objects and data containers

A data container is a `data class` with `val` properties and no behaviour. A real object is a `class` with private state and public functions. Named arguments already make a long call readable, so group parameters into a `data class` when the same group travels through several functions.

```kotlin
data class Rectangle(val x: Int, val y: Int, val width: Int, val height: Int)

fun draw(rectangle: Rectangle)
```

## Polymorphism

A `sealed interface` or `sealed class` with one implementation per variant replaces a `when` that repeats across functions. Keep one `when` in the factory. An exhaustive `when` over a sealed type in a single place is fine on its own.

```kotlin
sealed interface Delivery {
    fun deliver()
    fun track()
}

fun createDelivery(purchase: Purchase): Delivery = when (purchase.kind) {
    Kind.EXPRESS -> ExpressDelivery(purchase)
    Kind.INSURED -> InsuredDelivery(purchase)
    Kind.STANDARD -> StandardDelivery(purchase)
}
```

## Explicit over compact

The constructs that tempt: chained scope functions (`let`, `also`, `apply`, `run`) where `it` and `this` change meaning per link, `?.let` used as an `if`, a `when` packed into one expression with side effects, `it` in a lambda longer than one line, and elvis chains that hide which fallback fires.

Before:

```kotlin
val name = user?.profile?.let { it.displayName ?: it.email }?.also { log(it) } ?: "Anonymous"
```

After:

```kotlin
fun displayName(user: User?): String {
    val profile = user?.profile ?: return "Anonymous"
    val name = profile.displayName ?: profile.email
    log(name)
    return name
}
```

Stays as it is:

```kotlin
val total = items.filter { it.isActive }.sumOf { it.price * it.quantity }
```

This one stays. Each link names its step and `it` is the obvious item. The line becomes a candidate once a lambda spans several lines or `it` stops being obvious, then the lambda parameter gets a name.

Before:

```kotlin
order?.let { if (it.isPaid) ship(it) else remind(it) }
```

After:

```kotlin
if (order == null) return
if (order.isPaid) ship(order) else remind(order)
```

The guard replaces `?.let` only when nothing after the block needs to run for a null order. When something does, keep an `if (order != null)` block around the two lines instead.

## Ordering

Inside a class: properties, `init`, then public functions in call order, then private functions in call order. Top-level functions follow the stepdown rule directly, callers above callees.

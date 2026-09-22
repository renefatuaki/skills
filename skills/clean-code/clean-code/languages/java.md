# Java

Idioms for the rules in [../SKILL.md](../SKILL.md). Follow the project's existing choices where they differ.

## Naming

Classes `UpperCamelCase`, methods and fields `lowerCamelCase`, constants `SCREAMING_SNAKE_CASE`. Booleans read as questions, `isValid`, `hasNext`. Accessors keep the `get`, `is` and `set` prefixes the ecosystem expects, records drop them.

- [Google Java Style Guide](https://google.github.io/styleguide/javaguide.html)

## Guards and errors

Guards are early `return` or `throw` at the top of the method, `Objects.requireNonNull` for null preconditions.

```java
void messageUser(User user, String message) {
    if (user == null || message == null || !user.acceptsMessages()) {
        return;
    }
    user.send(message);
}
```

Real errors are exceptions. Use an unchecked exception for a caller bug and a checked or domain exception for a failure the caller must handle, following the project's convention. A returned status code, a boolean success flag or a `null` meaning failure is synthetic.

```java
final class SignUpException extends RuntimeException {
    SignUpException(String message) {
        super(message);
    }
}

void validateInput(String email, String password) {
    if (!email.contains("@") || password.length() < 8) {
        throw new SignUpException("Invalid input");
    }
    if (userExists(email)) {
        throw new SignUpException("Email taken");
    }
}
```

## Parameter objects and data containers

A data container is a `record`. A real object is a `class` with private fields and public methods. Group related parameters into a `record` and pass that.

```java
record Rectangle(int x, int y, int width, int height) {}

void draw(Rectangle rectangle)
```

A record with business methods, or a class that exposes its fields and also carries behaviour, mixes the two kinds.

## Polymorphism

An `interface` with one implementation per variant replaces `if` and `switch` chains on a type field that repeat across methods. A `sealed interface` with a pattern-matching `switch` in one place is the closed-variant alternative.

```java
interface Delivery {
    void deliver();
    void track();
}

static Delivery createDelivery(Purchase purchase) {
    return switch (purchase.kind()) {
        case EXPRESS -> new ExpressDelivery(purchase);
        case INSURED -> new InsuredDelivery(purchase);
        case STANDARD -> new StandardDelivery(purchase);
    };
}
```

## Explicit over compact

The constructs that tempt: a stream pipeline that does several things per stage or spans many stages, nested ternaries, `Optional` chains with `map` and `orElseGet` where an `if` reads as a sentence, and one-letter lambda parameters in a lambda longer than one line.

Before:

```java
String label = user == null ? "Anonymous" : user.isAdmin() ? "Admin" : user.isGuest() ? "Guest" : "Member";
```

After:

```java
static String roleLabel(User user) {
    if (user == null) return "Anonymous";
    if (user.isAdmin()) return "Admin";
    if (user.isGuest()) return "Guest";
    return "Member";
}
```

Before:

```java
int total = items.stream().filter(i -> i.isActive()).mapToInt(i -> i.price() * i.quantity()).sum();
```

After:

```java
List<Item> activeItems = items.stream().filter(Item::isActive).toList();
int total = activeItems.stream().mapToInt(item -> item.price() * item.quantity()).sum();
```

A short pipeline with method references and one operation per stage stays. It becomes a candidate when a stage holds a block lambda, or when the pipeline collects into a map and reads it back.

## Ordering

Inside a class: fields, constructors, public methods in call order, then private methods in call order. Java resolves methods regardless of order, so the stepdown rule applies fully.

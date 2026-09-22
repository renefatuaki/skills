# Python

Idioms for the rules in [../SKILL.md](../SKILL.md). Follow the project's existing choices where they differ.

## Naming

Classes `CapWords`, functions, methods and variables `snake_case`, constants `SCREAMING_SNAKE_CASE`. Booleans read as questions, `is_valid`, `has_content`. A single leading underscore marks a private member. A plain attribute or a `@property` replaces a `get_x()` method that does no work.

- [PEP 8, naming conventions](https://peps.python.org/pep-0008/#naming-conventions)

## Guards and errors

Guards are early `return` or `raise` at the top of the function.

```python
def message_user(user: User | None, message: str | None) -> None:
    if user is None or message is None or not user.accepts_messages:
        return
    user.send(message)
```

Real errors are raised exceptions, one class per failure the caller distinguishes. A returned code, a `None` meaning failure or a `(ok, value)` tuple is synthetic.

```python
class SignUpError(Exception):
    pass


def validate_input(email: str, password: str) -> None:
    if "@" not in email or len(password) < 8:
        raise SignUpError("Invalid input")
    if user_exists(email):
        raise SignUpError("Email taken")
```

## Parameter objects and data containers

A data container is a `@dataclass(frozen=True)`, a `NamedTuple` or a `TypedDict` for dict-shaped data. A real object is a class with underscore-prefixed state and public methods. Keyword-only arguments already make a long call readable, so group parameters into a dataclass when the same group travels through several functions.

```python
@dataclass(frozen=True)
class Rectangle:
    x: int
    y: int
    width: int
    height: int


def draw(rectangle: Rectangle) -> None: ...
```

## Polymorphism

A `Protocol` or an `ABC` with one class per variant replaces `if` chains on a type field that repeat across methods. The factory holds the single check, a `dict` from kind to class often replaces the chain entirely.

```python
class Delivery(Protocol):
    def deliver(self) -> None: ...
    def track(self) -> None: ...


DELIVERIES: dict[Kind, type[Delivery]] = {
    Kind.EXPRESS: ExpressDelivery,
    Kind.INSURED: InsuredDelivery,
    Kind.STANDARD: StandardDelivery,
}


def create_delivery(purchase: Purchase) -> Delivery:
    return DELIVERIES[purchase.kind](purchase)
```

## Explicit over compact

The constructs that tempt: a comprehension with a condition and a nested loop, a conditional expression inside a comprehension, `lambda` assigned to a name, chained comparisons mixed with `and` and `or`, `or` used as a fallback where `None` and falsy differ, and a one-liner that packs a `try` into a conditional.

Before:

```python
total = sum(i.price * i.qty for i in items if i.active and not i.deleted)
```

After:

```python
active_items = [item for item in items if item.is_active and not item.is_deleted]
total = sum(item.price * item.quantity for item in active_items)
```

Before:

```python
label = "Anonymous" if not user else "Admin" if user.is_admin else "Guest" if user.is_guest else "Member"
```

After:

```python
def role_label(user: User | None) -> str:
    if user is None:
        return "Anonymous"
    if user.is_admin:
        return "Admin"
    if user.is_guest:
        return "Guest"
    return "Member"
```

Stays as it is:

```python
name = user.display_name or user.email or "Anonymous"
```

This one stays when every fallback is a string. It becomes a candidate when an empty string or zero is a valid value, then `is None` checks say what is meant.

## Ordering

Module-level names must exist before they are called at import time, but functions resolve their callees at call time, so the stepdown rule applies fully to functions: callers above callees. Inside a class: `__init__`, dunder methods, public methods in call order, then private methods in call order.

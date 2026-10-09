# Formatting

Formatting is vertical here. Line length, indentation and bracket placement belong to the formatter and linter the language guide sets up. The skill does not restate the formatter. Inside a body, where no linter sets it, a blank line follows the imports, a group of declarations and a one-line if or loop, surrounds every block, type and multi-line statement, and precedes `return` and `throw`. Where the code file has no formatter, keep lines short enough to read without scrolling and break a long expression into named parts instead of wrapping it. Examples are pseudocode.

## Stepdown rule

A reader reads top to bottom. A function is placed below the function that calls it, so the reader meets the intent first and the mechanism after, and never scrolls up to learn what a name means.

```text
function login(email, password)
  validate(email, password)
  ...

function validate(email, password)
  ...
```

Inside a class, visibility comes first and stepdown second: the public API in call order at the top, then the private helpers in the order they are called. A public method and the private method it calls are not interleaved, because a reader scanning the API expects to see it whole. Swift `MARK` groups from the code-comments skill sit above this rule and keep their own order.

```text
class Account
  public deposit(amount)
    validateAmount(amount)
    record(amount)

  public withdraw(amount)
    validateAmount(amount)
    record(-amount)

  private validateAmount(amount)
    ...

  private record(amount)
    ...
```

`deposit` and `withdraw` form the API. `validateAmount` comes first among the helpers because it is called first, `record` follows.

Languages that require declaration before use (or that resolve hoisting differently) win over this rule. Follow the language guide.

## Splitting files

A file that holds several unrelated things, two classes with no shared purpose, a component and an unrelated helper, is two files. Each file then reads as one topic and the imports say what it depends on.

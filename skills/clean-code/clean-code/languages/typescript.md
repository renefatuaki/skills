# TypeScript and JavaScript

Idioms for the rules in [../SKILL.md](../SKILL.md). Follow the project's existing choices where they differ.

## Naming

Types, classes, interfaces and React components `UpperCamelCase`, functions and variables `lowerCamelCase`, module-level constants `SCREAMING_SNAKE_CASE` where the project does so. Booleans read as questions, `isValid`, `hasContent`. No `I` prefix on interfaces. Hooks start with `use`.

- [Google TypeScript Style Guide, naming](https://google.github.io/styleguide/tsguide.html#naming)

## Guards and errors

Guards are early `return` or `throw` at the top of the function.

```ts
function messageUser(user: User | undefined, message: string | undefined): void {
  if (!user || !message || !user.acceptsMessages) return
  user.send(message)
}
```

Real errors are thrown `Error` subclasses or, where the project already uses results, discriminated result unions. Avoid error codes, booleans, or message objects alongside normal values, as they can be ignored by the caller.

```ts
class SignUpError extends Error {}

function validateInput(email: string, password: string): void {
  if (!email.includes('@') || password.length < 8) throw new SignUpError('Invalid input')
  if (userExists(email)) throw new SignUpError('Email taken')
}
```

## Parameter objects and data containers

A data container is a `type` or `interface` with plain fields, used as an object literal. A real object is a `class` with `private` fields and public methods. Group related parameters into one object parameter, destructured in the signature.

```ts
type Rectangle = { x: number; y: number; width: number; height: number }

function draw({ x, y, width, height }: Rectangle): void
```

## Polymorphism

An `interface` with one class per variant replaces `if` chains on a type field that repeat across methods, the factory holds the single check. A discriminated union with one exhaustive `switch` is the closed-variant alternative when the behaviour lives in one place.

```ts
interface Delivery {
  deliver(): void
  track(): void
}

function createDelivery(purchase: Purchase): Delivery {
  switch (purchase.kind) {
    case 'express': return new ExpressDelivery(purchase)
    case 'insured': return new InsuredDelivery(purchase)
    case 'standard': return new StandardDelivery(purchase)
  }
}
```

## Explicit over compact

The constructs that tempt: nested ternaries, `&&` and `||` used as control flow, `reduce` where a loop or `map` plus `filter` says the same, one-letter callback parameters, and a chain of optional access and nullish coalescing that hides which value the reader ends up with.

Before:

```ts
const label = user ? (user.isAdmin ? 'Admin' : user.isGuest ? 'Guest' : 'Member') : 'Anonymous'
```

After:

```ts
function roleLabel(user: User | undefined): string {
  if (!user) return 'Anonymous'
  if (user.isAdmin) return 'Admin'
  if (user.isGuest) return 'Guest'
  return 'Member'
}
```

Before:

```ts
const total = items.reduce((a, i) => a + (i.active ? i.price * i.qty : 0), 0)
```

After:

```ts
const activeItems = items.filter((item) => item.isActive)
const total = activeItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
```

Before:

```ts
isReady && !isLoading && render()
```

After:

```ts
if (isReady && !isLoading) render()
```

In JSX, `condition && <Element />` is the idiom and stays. A ternary with a nested ternary inside JSX is extracted into a sub-component or a function that returns the element.

## Ordering

Function declarations hoist, so the stepdown rule applies fully in a module: exports and callers first, helpers below. `const` arrow functions are not hoisted, so with them either declare helpers first or switch the helpers to declarations. Inside a class: fields, constructor, public methods in call order, then private methods in call order.

## React and Next.js

A component file holds one component and the hooks and helpers only it uses. Extract a hook when a component owns more than one concern of state or effects. Keep JSX flat by extracting a sub-component instead of nesting conditionals inside the tree.

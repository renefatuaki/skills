# Naming

A name has one job: say what a variable holds, what a function does, or what kind of object a class produces. When names do that, the reader never opens the body to find out. When they do not, no other rule in this skill repairs the damage. Examples are pseudocode, the language guides carry the casing and conventions.

## Variables and properties

Variables hold data, so they get a noun that names the data: `user`, `product`, `transaction`, `database`. Prefer the specific noun the domain uses, `customer` over `user` when the code does customer work.

Booleans read as a yes or no question: `isValid`, `hasContent`, `didAuthenticate`, `emailExists`. Sentences with adjectives or participles are fine as long as the reader can answer yes or no.

A name describes, it does not narrate. `loggedInUser` says everything `loggedInUserAuthenticatedByEmailAndPassword` says, in a quarter of the space.

## Functions and methods

Functions perform an action, so they get a verb: `login()`, `createUser()`, `database.insert()`, `log()`. A function that mainly produces a value, especially a boolean, reads as a question: `isValid(...)`, `isEmpty(...)`.

A bare noun as a function name reads like a property. `email()` and `user()` mislead, `getEmail()` and `findUser()` say what happens.

Specific beats generic: `createUser()` over `create()`, `processTransaction()` over `process()`. `handle`, `process`, `manage`, `do` and `data` are placeholders. Replace them with the actual verb and the actual noun.

## Classes

A class name is a noun for the kind of object it produces: `User`, `Product`, `RootAdministrator`, `Payment`. A static or utility class is a container and is named for what it contains.

## Consistency

One concept, one word. When the project fetches with `fetch`, every new fetch is `fetchX`, never `getX` or `retrieveX`. Which word wins is settled by the neighbouring code, not by preference. Read before naming.

## Misleading names

The worst name is one that says the wrong thing. Before:

```text
function login(email, password)
  createUser(email, password)
  createSession()
```

The reader trusts `login` and never learns a user is created. After:

```text
function signUp(email, password)
  createUser(email, password)
  createSession()
```

An existing misleading name is not adopted because it is there. The rename policy in [../SKILL.md](../SKILL.md) under Renaming decides whether you rename now or propose.

## Before and after

Before:

```text
d = fetchData(id)
if (d.t == 1)
  handle(d)
```

After:

```text
order = fetchOrder(orderId)
if (order.isPaid)
  shipOrder(order)
```

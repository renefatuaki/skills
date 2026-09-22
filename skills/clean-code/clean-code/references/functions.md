# Functions

A function has a name, parameters and a body. Naming is covered in [naming.md](naming.md). This file covers the parameters and the body. Examples are pseudocode.

## Parameters

Fewer parameters read and call easier. Zero and one need no explanation at the call site. Two work when the order is obvious from the domain, `login(email, password)`, and confuse when it is not, `sortUsers('email', 'asc')`. Beyond that, the caller memorises positions and the reader guesses meanings.

Before:

```text
createRectangle(10, 9, 30, 12)
```

After:

```text
createRectangle({ x: 10, y: 9, width: 30, height: 12 })
```

Group parameters that belong together into one container whose field names carry the meaning. The language guide names the container type.

## One thing

A function does one thing when every statement in its body sits on the same level of abstraction, one level below the level the name promises.

```text
function login(email, password)
  validateUserInput(email, password)
  verifyCredentials(email, password)
  createSession()
```

Three calls, and still one thing: each call is one step of logging in, none of them is a detail of one step.

### Levels of abstraction

`db.connect()` is high level, the reader sees an intention. `uri == ''` and `console.log(...)` are low level, the reader sees a mechanism. Neither level is bad. Mixing them in one body is, because the reader switches between intention and mechanism on every line.

Before:

```text
function printDocument(path)
  config = { mode: 'read', onError: 'retry' }
  document = fileSystem.readFile(path, config)
  printer = new Printer('pdf')
  printer.print(document)
```

After:

```text
function printDocument(path)
  document = readFromFile(path)
  printer = new Printer('pdf')
  printer.print(document)
```

### Two rules of thumb

Analysing levels of abstraction line by line is slow. Two rules find the same splits:

1. **Extract what belongs together.** Statements that work on the same thing form a sub-task with a name.
2. **Extract what needs interpretation.** A condition or expression the reader has to decode gets a name that states what it means.

Rule 1, before:

```text
function updateUser(userData)
  validateUserData(userData)
  user = findUserById(userData.id)
  user.setAge(userData.age)
  user.setName(userData.name)
  user.save()
```

After:

```text
function updateUser(userData)
  validateUserData(userData)
  applyUpdate(userData)

function applyUpdate(userData)
  user = findUserById(userData.id)
  user.setAge(userData.age)
  user.setName(userData.name)
  user.save()
```

Rule 2, before:

```text
function processTransaction(transaction)
  if (transaction.type == 'UNKNOWN')
    throw Error('Invalid transaction type.')
  if (transaction.type == 'PAYMENT')
    processPayment(transaction)
```

After:

```text
function processTransaction(transaction)
  validateTransaction(transaction)
  if (isPayment(transaction))
    processPayment(transaction)
```

## Split reasonably

Extraction has a cost: one more name to read and one more jump to follow. Three signals say a split went too far:

1. The new function only renames the statement it wraps, `throwError(message)` around `throw Error(message)`.
2. Following a simple thought now means scrolling between functions.
3. No good name is free, because the obvious one is taken by the caller, `buildUser` next to `createUser`.

Before:

```text
function saveUser(email, password)
  user = buildUser(email, password)
  user.save()

function buildUser(email, password)
  return new User(email, password)
```

After:

```text
function saveUser(email, password)
  user = new User(email, password)
  user.save()
```

## Side effects

A side effect changes state outside the function: a write, a request, a log line, a mutation of shared data. Side effects are the point of most programs. An unexpected side effect is one the name or the calling context does not imply.

Before:

```text
function validateUserInput(email, password)
  if (isInvalid(email, password))
    throw Error('Invalid input')
  createSession()
```

Nobody calling `validateUserInput` expects a session. Move the effect to the function whose name promises it, or rename the function so the promise matches.

After:

```text
function login(email, password)
  validateUserInput(email, password)
  createSession()
```

## One place per piece of logic

Logic that appears twice drifts apart on the next change. When two bodies share a block, extract it once and call it twice. Structural similarity alone is not duplication: two blocks that look alike but change for different reasons stay separate.

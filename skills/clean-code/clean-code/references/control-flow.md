# Control flow

Conditions, loops and error handling coordinate the program, and they are where reading effort piles up. Three levers keep it low: positive checks, flat nesting, real errors. Examples are pseudocode, the language guides show the guard and error idiom of each language.

## Positive checks

A positive check reads without translation. `isEmpty(content)` asks one thing, `!hasContent(content)` asks the reader to flip the answer.

The exception: a single negative check that stands in for a growing list of positives.

```text
if (!isOpen(transaction))
  throw Error('Transaction is not open')
```

Spelling this positively means `isClosed(transaction) || isUnknown(transaction) || ...`, and the list grows with every new state. One negative check on the one state you need beats enumerating every state you do not.

## Guards and fail fast

A guard is a check at the top of the function that exits when the precondition fails. The rest of the body then runs in the happy path without indentation.

Before:

```text
function messageUser(user, message)
  if (user)
    if (message)
      if (user.acceptsMessages)
        user.sendMessage(message)
        log('Message sent')
```

After:

```text
function messageUser(user, message)
  if (!user || !message || !user.acceptsMessages)
    return
  user.sendMessage(message)
  log('Message sent')
```

Invert the nested conditions, combine them, exit early. Whether the guard returns or throws depends on whether the caller can continue without the work.

## Extract the nested structure

When a branch holds its own decision tree, the tree is a sub-task. Extract it under a name that states what it decides.

Before:

```text
function checkout(cart, customer)
  validateCart(cart)
  if (customer.isMember)
    if (cart.total > 100)
      applyDiscount(cart, 0.2)
    else
      applyDiscount(cart, 0.1)
  else if (cart.total > 100)
    applyDiscount(cart, 0.05)
  charge(cart)
```

After:

```text
function checkout(cart, customer)
  validateCart(cart)
  applyDiscount(cart, getDiscountRate(cart, customer))
  charge(cart)

function getDiscountRate(cart, customer)
  isLargeOrder = cart.total > 100
  if (customer.isMember && isLargeOrder) return 0.2
  if (customer.isMember) return 0.1
  if (isLargeOrder) return 0.05
  return 0
```

All four paths are valid, so nothing here is a precondition. The tree gets the name `getDiscountRate` and lies flat inside it, and `checkout` reads as three steps.

## Polymorphism and factories

Repeated checks on the same type field, each with slightly different code inside, are one decision made many times. Make it once, in a factory that returns an object whose methods already know the answer.

Before:

```text
function processTransaction(transaction)
  if (usesCreditCard(transaction)) processCreditCardPayment(transaction)
  if (usesPayPal(transaction)) processPayPalPayment(transaction)
```

After:

```text
function processTransaction(transaction)
  createProcessor(transaction).processPayment(transaction)
```

The check moves into `createProcessor`, which returns a `CreditCardProcessor` or a `PayPalProcessor` and throws for anything else. Every other function that branched on the payment method now calls the processor instead. The hierarchy behind the factory is in [classes.md](classes.md) under Polymorphism.

## Real errors

A synthetic error is a failure encoded as data: a status code, a boolean, a message object, that every caller must inspect with `if`. A real error uses the language's failure channel, so it interrupts the flow by itself and is handled once, where handling belongs.

Before:

```text
function createUser(email, password)
  result = validateInput(email, password)
  if (result.code == 1 || result.code == 2)
    log(result.message)
    return
  ...

function validateInput(email, password)
  if (!isEmail(email)) return { code: 1, message: 'Invalid input' }
  if (userExists(email)) return { code: 2, message: 'Email taken' }
```

After:

```text
function handleSignUpRequest(request)
  try
    createUser(request.email, request.password)
  catch (error)
    log(error.message)

function createUser(email, password)
  validateInput(email, password)
  ...

function validateInput(email, password)
  if (!isEmail(email)) throw Error('Invalid input')
  if (userExists(email)) throw Error('Email taken')
```

Error handling is one thing, so it lives in its own function, usually the caller that decides what a failure means for the user. The functions in between raise and propagate without inspecting.

Which contract is real depends on the language and the project: an exception, a `Result`, a sealed error type, an error return the language enforces. The language guide names it. Follow the project's existing choice. What stays synthetic in every language is a code or flag beside a normal value that the caller may forget to check.

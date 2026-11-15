# Classes and objects

These rules come from object-oriented design and pay off in any style that groups data with behaviour. Examples are pseudocode, the language guides name the container and polymorphism idiom of each language.

## Real objects and data containers

A data container holds data and nothing else: public fields, no behaviour beyond read-only derived values such as a computed property. A real object hides its data and exposes behaviour: private fields, public methods.

```text
class UserData
  public name
  public age

class User
  private name
  private age
  greet()
    print('Hi, I am ' + name)
```

Both are legitimate. Pick one per class and keep it: a container with methods, or an object whose fields are reached from outside, is neither. Reading a container's fields is expected. Reaching into an object's fields ties the caller to the object's internals and breaks on the next refactor.

## Small classes

A class is small when it has one responsibility, not when it has one method. `User` holding `login()` and `logout()` is right. `User` also holding `refund()` is two classes, however short the code. Size is counted in responsibilities.

## Cohesion

Cohesion is how many of a class's methods use how many of its fields. Every method using every field is maximal. Methods that ignore the fields signal a class that is really a data container plus a bag of functions, or two classes glued together. Falling cohesion is the cue to split.

## Law of Demeter

A method talks only to four kinds of object: the one it belongs to, the objects held in its own fields, its parameters, and objects it creates. On each of those it calls public methods. It does not take a value one of them returns and reach on into that value's internals.

In the example, `Customer` and `Purchase` are real objects, `customer` is a field of the current class.

Before:

```text
date = this.customer.lastPurchase.date
this.warehouse.deliverPurchasesByDate(this.customer, date)
```

The first hop, `this.customer`, is allowed. The second, `.lastPurchase`, reaches into `Customer`, and the third, `.date`, reaches into `Purchase`. The chain binds this method to the shape of both classes. Rename `date` and every chain breaks.

After:

```text
this.warehouse.deliverPurchase(this.customer.lastPurchase())
```

`lastPurchase()` is a public method on the field `customer`, one hop. Its result goes straight to a collaborator, `warehouse`, which is also a field. Nothing here knows what a `Purchase` looks like inside.

Tell, don't ask: give the collaborator what it needs and let it act, instead of pulling data out and deciding here. Had `Customer` been a data container, the original chain would have been fine, see the last paragraph. Chaining real methods is fine, `customer.sendMessage(message).retry(2)` uses two public interfaces. Chaining through data containers is fine too, that is what their public fields are for. The law targets reaching into a real object's internals.

## Polymorphism

Repeated `if` chains on the same type field are a class hierarchy waiting to be written.

Before:

```text
class Delivery
  deliverProduct()
    if (type == 'express') Logistics.issueExpress(product)
    else if (type == 'insured') Logistics.issueInsured(product)
    else Logistics.issueStandard(product)
  trackProduct()
    if (type == 'express') Logistics.trackExpress(product)
    else if (type == 'insured') Logistics.trackInsured(product)
    else Logistics.trackStandard(product)
```

After:

```text
class ExpressDelivery extends Delivery
  deliverProduct() Logistics.issueExpress(product)
  trackProduct() Logistics.trackExpress(product)

class InsuredDelivery extends Delivery
  ...

function createDelivery(purchase)
  if (purchase.type == 'express') return new ExpressDelivery(purchase)
  if (purchase.type == 'insured') return new InsuredDelivery(purchase)
  return new StandardDelivery(purchase)
```

The type check happens once, in the factory. Every method reads as a single line of intent. Adding a delivery kind adds a class and one factory line, the existing classes stay untouched.

## Single responsibility

A class changes for one reason. `ReportDocument` with `generateReport()` and `createPdf()` changes when the report logic changes and when the PDF layout changes, two reasons, two classes: `Report` and `PdfPrinter`. This is the principle behind small classes above.

## Open for extension, closed for modification

Once a class's public shape is settled, new variants are added beside it, not inside it. A `Printer` with `printPdf()`, `printWeb()`, `printPage()` reopens on every new format. A `Printer` interface with one `print()` and one implementation per format never reopens. This is the polymorphism move above, applied to design.

## The other three

Liskov substitution: a subtype must work everywhere its base type works. A `Penguin` that extends a `Bird` with `fly()` breaks that. Model the hierarchy so every subtype honours the base contract, `FlyingBird` beside `Bird`.

Interface segregation: several small interfaces beat one wide one. An `InMemoryDatabase` forced to implement `connect()` because `Database` declares it needs `Database` split into `Database` and `RemoteDatabase`.

Dependency inversion: depend on the abstraction, not the concrete type. A constructor that checks which database it received and connects some of them depends on concretions. Take a `Database` that is already connected and let the caller do the connecting.

These three shape modelling more than readability. Apply them when you design a hierarchy, and lean on the first two principles for everyday code.

## Common sense

Every rule here shrinks classes. None of them asks for a project of a hundred classes with one method each. A class is allowed to do work. Group related data and behaviour, split when a second responsibility appears, and stop there.

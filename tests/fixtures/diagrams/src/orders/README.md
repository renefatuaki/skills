# Orders

How does an order get from the cart to the warehouse?

```mermaid
flowchart TD
  accTitle: How does an order get from the cart to the warehouse?
  checkOrder["Check the order"] --> chargePayment{"Charge the payment"}
  chargePayment -->|paid| shipOrder["Ship the order"]
  chargePayment -->|declined| rejectOrder["Reject the order"]
```

| Element | Source |
| --- | --- |
| `checkOrder` | [`checkOrder`](checkout.ts) |
| `chargePayment` | [`chargePayment`](payment.ts) |
| `shipOrder` | [`shipOrder`](checkout.ts) |
| `rejectOrder` | [`rejectOrder`](checkout.ts) |

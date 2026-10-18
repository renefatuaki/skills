# Refund

How does a refund get back to the customer?

```mermaid
flowchart TD
  accTitle: How does a refund get back to the customer?
  refundPayment{"Refund the payment"} -->|"within 30 days"| creditCustomer["Credit the customer"]
  refundPayment -->|"after 30 days, the provider closes the payment (refund_expired)"| rejectRefund["Reject the refund"]
```

| Element | Source |
| --- | --- |
| `refundPayment` | [`refundPayment`](../refund.ts) |
| `creditCustomer` | [`creditCustomer`](../refund.ts) |
| `rejectRefund` | [`rejectRefund`](../refund.ts) |

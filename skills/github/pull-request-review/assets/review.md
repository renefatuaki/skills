<!-- Review of a test plan, the verdict first, then every step, then a finding per step that did not pass and the evidence of the rest. -->
<!-- https://docs.github.com/en/pull-requests/reference/pull-request-reviews.md -->

**<verdict>** · <passed> of <total> passed · tested at <sha>

| # | Step | Result | Tested by |
|---|---|---|---|
| 1 | <action> | Passed | Agent |
| 2 | <action> | Failed | Reviewer |
| 3 | <action> | Blocked | Reviewer |

### Findings

#### 2. <action>

- **Expected** <result the test plan names>
- **Observed** <what happened instead>
- **Evidence** <output, log line or what the reviewer saw>

#### 3. <action>

- **Blocked** <why the step could not run>

<details><summary>Evidence of passed steps</summary>

#### 1. <action>

```text
<observed output>
```

</details>

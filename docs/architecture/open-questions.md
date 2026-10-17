# Open questions

| # | Question | Notes | Owner |
|---|---|---|---|
| Q1 | How do we get the **hosted** OZ facilitator to accept smart-account payments? | Partly answered: a self-hosted `@x402/stellar` 2.28.0 facilitator (500k ceiling, policy-event allowance) settled tx `50466d23…fe4477` on testnet. Open: OZ hosted facilitator rejects fees above 50k (measured ~319k warm) and non-`transfer` events from OZ `spending_limit`/`simple_threshold` and `jev_policy`. Plan: propose a policy-event allowance + smart-account fee profile upstream (grant deliverable), reduce footprint. | Jose / OZ |
| Q2 | Escalation UX | How the owner approves escalated payments (push + passkey) outside the simulator | Team |
| Q3 | Operator decentralization | Who runs operators in production; registry governance; epoch rotation | Team |
| Q4 | Canonical intent format | Freeze a spec for the intent JSON so third parties can compute `intent_hash` | Team |
| Q5 | Second model family | Which open-weight model via OpenRouter; TypeSafe and OpenRouter BYOK terms [TODO verify] | Jose |
| Q6 | Upstream OZ release | Move from pinned commit `33b665b` to a tagged release targeting sdk 28 when available | Team |
| Q7 | Error-code names | Confirm OZ names for observed codes 3003 and 3221 | Team |
| Q8 | License | MIT vs Apache-2.0 | Jose |
| Q9 | Real-traffic evaluation | Get a pilot partner for non-synthetic evaluation data | Jose |

# Open questions

| # | Question | Notes | Owner |
|---|---|---|---|
| Q1 | How do we get x402 settling with smart-account payments? | OZ hosted facilitator rejects fees above 50k stroops; measured 310k–5.73M. Options: ask OZ to raise the ceiling for smart accounts, run our own facilitator, reduce footprint (fewer policies/simulation tuning), or fee-bump sponsorship. | Jose / OZ |
| Q2 | Escalation UX | How the owner approves escalated payments (push + passkey) outside the simulator | Team |
| Q3 | Operator decentralization | Who runs operators in production; registry governance; epoch rotation | Team |
| Q4 | Canonical intent format | Freeze a spec for the intent JSON so third parties can compute `intent_hash` | Team |
| Q5 | Second model family | Which open-weight model via OpenRouter; TypeSafe and OpenRouter BYOK terms [TODO verify] | Jose |
| Q6 | Upstream OZ release | Move from pinned commit `33b665b` to a tagged release targeting sdk 28 when available | Team |
| Q7 | Error-code names | Confirm OZ names for observed codes 3003 and 3221 | Team |
| Q8 | License | MIT vs Apache-2.0 | Jose |
| Q9 | Real-traffic evaluation | Get a pilot partner for non-synthetic evaluation data | Jose |

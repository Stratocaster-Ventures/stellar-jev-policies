# Open questions

| # | Question | Notes | Owner |
|---|---|---|---|
| Q1 | How do we get the **hosted** OZ facilitator to accept smart-account payments? | Partly answered: independently reproduced the public upstream issues ([#3352](https://github.com/x402-foundation/x402/issues/3352), [#3515](https://github.com/x402-foundation/x402/issues/3515), [PR #3399](https://github.com/x402-foundation/x402/pull/3399), [OZ #53](https://github.com/OpenZeppelin/relayer-plugin-x402-facilitator/issues/53)); self-hosted facilitator settled tx `50466d23…fe4477` on testnet. Open: land the upstream fix on the hosted OZ path; reduce footprint. | Jose / OZ |
| Q2 | Escalation UX | How the owner approves escalated payments (push + passkey) outside the simulator | Team |
| Q3 | Operator decentralization | Who runs operators in production; registry governance; epoch rotation | Team |
| Q4 | Canonical intent format | Freeze a spec for the intent JSON so third parties can compute `intent_hash` | Team |
| Q5 | Second model family | Which open-weight model via OpenRouter; TypeSafe and OpenRouter BYOK terms (to be verified) | Jose |
| Q6 | Upstream OZ release | Move from pinned commit `8e25220` to a tagged release targeting sdk 28 when available | Team |
| Q7 | Error-code names | Confirm OZ names for observed codes 3003 and 3221 | Team |
| Q8 | License | **Resolved: MIT** (Cargo.toml, package.json, LICENSE © 2026 Stratocaster Ventures SA de CV) | — |
| Q9 | Real-traffic evaluation | Get a pilot partner for non-synthetic evaluation data | Jose |

# Errors and events

## jev_verifier (`JevVerifierError`)

| Code | Name | Meaning |
|---|---|---|
| 4100 | MalformedKey | Wrong version or length |
| 4101 | MalformedDecision | `sig_data` is not a valid `JevDecision` |
| 4102 | InvalidHashLength | Digest is not 32 bytes |
| 4103 | InvalidKeyParams | k/n/tau/max_age out of range |

A vetoed or stale decision is not an error: `verify` returns false and OZ rejects the auth.

## jev_policy (`JevPolicyError`)

| Code | Name |
|---|---|
| 4200 | NotInstalled |
| 4201 | AlreadyInstalled |
| 4202 | SpendingLimitMissing |
| 4203 | JevSignerMissing |
| 4204 | NotAllowlisted |
| 4205 | NonContractContext |
| 4206 | AmountExceedsTokenRule |
| 4207 | RecipientNotAllowed |
| 4208 | InvalidParams |
| 4209 | BadAmount |

## Codes observed on testnet (from `deployments/testnet.json`)

| Scenario | Code | Origin |
|---|---|---|
| Jev veto | 3003 | OZ smart account (open item: confirm exact OZ error name at `33b665b`) |
| Recipient not allowed | 4207 | jev_policy |
| Per-call cap | 4206 | jev_policy |
| Spending window exceeded | 3221 | OZ spending_limit (open item: confirm name) |

## Events

`JevPolicyEnforced { #[topic] smart_account: Address, context_rule_id: u32, contract: Address, fn_name: Symbol }`, emitted by `jev_policy.enforce` on success. The verifier emits no events. Roadmap: add a decision event (decision id, verdict, model, operator epoch) to link on-chain decisions to traces.

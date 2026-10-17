# Threat model

Scope: POC contracts at the commit in `deployments/testnet.json` (OZ `33b665b`, soroban-sdk 28.0.0), operator service, web console. Not audited. Full proposal threat model: `/workspace/scf/gitbook/threat-model.md` (proposal workspace).

## Trust assumptions

- A1. The OZ smart account, verifiers and policies behave as specified upstream.
- A2. The owner passkey is not compromised.
- A3. At most `k-1` of `n` operator keys are compromised for the AI check to hold. If `k` are compromised, only invariants I3–I6 hold (bounded loss).
- A4. The Jev model can be wrong or manipulated; it is never trusted to expand permissions.
- A5. Ledger sequence is a reliable clock for freshness.
- A6. POC only: a single operator key in a local `.jev/` file (not acceptable for production).

## Invariants (test references in `contracts/*/src/test.rs`)

- I1. No agent transfer executes without a valid Jev ALLOW decision with `p_allow >= tau` signed over that transaction's `auth_digest`.
- I2. A decision is bound to the pinned `model_id`, `intent_hash`, `template_id` and is valid only within `max_age_ledgers`.
- I3. Every call must target an allowlisted `(contract, fn)`.
- I4. Token `transfer`/`approve` amounts never exceed the token's `max_amount`; `transfer` recipients are restricted when configured.
- I5. The rule's `spending_limit` must be present on every call; removing it disables the session (fail-closed).
- I6. Only the account's own auth (owner rule) can install, change or uninstall policies.
- I7. Any malformed key, decision or signature fails closed.

[TODO] Map each invariant to named tests and add property/fuzz tests (Grant, T1).

## STRIDE

| Threat | Example | Mitigation | Residual |
|---|---|---|---|
| Spoofing | Forged Jev decision | ed25519 k-of-n over auth digest (V7) | Operator key theft (see compromised-operator flow) |
| Tampering | Change amount/recipient after Jev approves | Decision signs the exact `auth_digest` | none known |
| Tampering | Swap model to a weaker one | `model_id` pinned in key (V5); operator rejects mismatched model [Grant] | Provider mislabelling responses [TODO] |
| Repudiation | Operator denies signing | Signatures on-chain; `JevPolicyEnforced` event | No decision event yet (Grant) |
| Info disclosure | Intent and tx details sent to Jev API | Minimal tx summary; only hashes on-chain | Third-party API sees payment metadata; Grant: redaction, BYOK |
| DoS | Jev/operator down | Fails closed; owner passkey still works | Liveness depends on operator (SLO in Grant) |
| DoS | Owner removes spending_limit by mistake | Session stops (I5) | Intended |
| Elevation | Prompt injection makes Jev allow | Jev can only restrict; I3–I5 bound loss; 0/125 attacks signed in bench | Model error on in-allowlist, in-cap payments |
| Elevation | Replay an old allow | Freshness window + digest binding | none known |

## Known limitations (POC)

- Not audited. Single operator, local key. No operator registry or epoch rotation.
- Benchmark is template-based (synthetic), 200 cases; real-world error rates may differ.
- x402 settlement through the OZ hosted facilitator is blocked by its fee ceiling.
- Escalation UX is a simulator in the console.

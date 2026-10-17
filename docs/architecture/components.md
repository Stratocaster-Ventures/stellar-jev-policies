# Components

| Component | Path | Status | Trust |
|---|---|---|---|
| `jev_verifier` | `contracts/jev_verifier` | POC, on testnet | Trusted code |
| `jev_policy` | `contracts/jev_policy` | POC, on testnet | Trusted code |
| OZ wrappers | `contracts/oz_*` | Thin deployable wrappers of OZ smart account, ed25519 verifier, simple_threshold, spending_limit | Upstream code |
| Off-chain Jev operator | `packages/jev-policies/src/operator.ts`, `jev.ts` | POC | Semi-trusted |
| CLI | `packages/jev-policies/src/cli.ts` | POC | Local tool |
| Web console | `apps/web` | POC | Local UI |
| x402 demo | `packages/jev-policies/scripts/x402-demo.mjs` | POC, blocked at facilitator | Demo |
| Benchmark | `bench/` | POC | Evidence |

## jev_verifier

OZ `Verifier`. Installed as `Signer::External(jev_verifier, encode_key(JevKey))`. `verify(hash, key_data, sig_data)` decodes the compact key and an XDR `JevDecision` and returns `true` only if: verdict is ALLOW and `p_allow_ppm >= tau_allow_ppm`; `model_id`, `intent_hash`, `template_id` match the key; `issued_ledger <= now <= expiry_ledger` and lifetime `<= max_age_ledgers`; exactly `k` signatures with strictly ascending operator indices, each a valid ed25519 signature over `sha256(xdr(DecisionBody))`. An invalid signature traps (fail-closed). `canonicalize_key` returns sha256 of the re-encoded key. Client helpers: `encode_key`, `decision_msg`. Max 4 operators. See [spec/contracts.md](spec/contracts.md).

## jev_policy

OZ `Policy`. `install` stores `JevPolicyParams` per `(smart_account, context_rule_id)` and requires that the Jev signer is on the rule. `enforce` runs on **every** call and panics (deny) unless: (a) the pinned `spending_limit` is still in the rule's policies; (b) the Jev signer is among authenticated signers; (c) the call's `(contract, fn)` is allowlisted; (d) for tokens with a rule, `transfer`/`approve` amount `<= max_amount` and `transfer` recipient is in the list (if non-empty). Emits `JevPolicyEnforced`. Read helper: `get_params`.

## Off-chain Jev operator

HTTP service (`cli operator`). Receives an unsigned authorization entry, summarizes it (`contract, fn, from, to, amount`), calls Jev (`JEV_API_URL`, default `https://api.typesafe.ai/v1/systemone`) with the intent and derived facts using prompt framing v4 and the pinned model `jev-1.13.0` (never "latest"), maps the result to verdict + `p_allow_ppm`, and signs the decision over the auth digest. Falls back to a deterministic mock when `JEV_API_KEY` is unset (clearly labelled `source: "mock"`). POC: single operator, key in a local `.jev/` file (never committed).

## CLI

Commands: `init` (generate local keys, fund fee payer), `account` (deploy OZ smart account), `install` (token-scoped session rule with `simple_threshold(2)` + `spending_limit` + `jev_policy`), `sign`/`transfer` (agent transfer co-signed by operator in one tx), `operator` (run the HTTP service), `status`.

## Web console

`scripts/passkey-e2e.mjs`: the same passkey-owner flow headless (software P-256 authenticator), with testnet txs in `deployments/testnet.json` (`demo_passkey_e2e`) and `deployments/testnet-passkey-e2e.log`.

`apps/web`: real passkey owner (secp256r1 via the OZ WebAuthn verifier listed in `deployments/testnet.json`), session install, a payment simulator with presets (allow, deny, escalate, compromised operator), and the "Field Notes" blog on recent exploits. Styled after Stratocaster's design system.

## x402 demo

`scripts/x402-demo.mjs` pays an x402-protected resource through the OpenZeppelin hosted facilitator on testnet. Jev decisions are correct, but the facilitator rejects at verify with `invalid_exact_stellar_payload_fee_exceeds_maximum`: the measured smart-account fee (310k–5.73M stroops) exceeds the facilitator's 50k-stroop ceiling. **No x402 payment has settled.** See [flows.md](flows.md#x402-payment-currently-blocked) and [open-questions.md](open-questions.md).

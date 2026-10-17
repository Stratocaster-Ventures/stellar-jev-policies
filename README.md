# Stellar JEV Policies — POC / MVP

> **Status: proof of concept.** This repository shows the core mechanism working end to end on
> Stellar testnet. It is **not production software**: it hasn't been audited, the operator keys sit in a
> local file, and the Jev integration is a thin client. The SCF Build Award proposal funds the
> production version (see [What the grant turns into production](#what-the-grant-turns-into-production)).

**Deterministic security + smart AI decisions.** An AI agent gets a *session* on an
OpenZeppelin smart account. Every agent transaction needs **two signatures in one transaction**:
the agent's key and a **Jev operator** that asked TypeSafe's Jev model whether the transaction fits the
intent the user signed at grant time. Deterministic on-chain rules cap what even a fully
compromised AI can do.

```
user (passkey*) ──add_context_rule──▶ OZ Smart Account (stellar-accounts, sdk 28)
                                       rule 1: CallContract(token) "jev-agent-session"
                                         signers:  agent ed25519  +  Signer::External(jev_verifier, JevKey)
                                         policies: simple_threshold(2) · spending_limit · jev_policy
agent ──tx──▶ __check_auth ──▶ jev_verifier.verify  (Jev decision: allow, p_allow ≥ τ, model/intent pinned, fresh, k-of-n sigs over auth_digest)
                          └──▶ policies (all must pass): threshold 2-of-2 · spending_limit window · jev_policy
```
\* In the POC the owner is an ed25519 key standing in for the passkey (OZ WebAuthn verifier).

## What's here

| Path | What |
|---|---|
| `contracts/jev_verifier` | OZ `Verifier`. The key data is a compact `JevKey` (operator set, k, pinned `model_id`, `intent_hash`, `tau_allow_ppm`, template, max age). The signature data is XDR `JevDecision`. It checks the verdict (deny/escalate veto), `p_allow ≥ τ`, the grant-time commitments, freshness, and k-of-n ed25519 signatures with strictly ascending indices over `sha256(xdr(DecisionBody{auth_digest,…}))`. |
| `contracts/jev_policy` | OZ `Policy` (install / enforce / uninstall, panic = deny). On **every** call it re-checks: (a) the pinned `spending_limit` is still on the rule, (b) the Jev signer authenticated, (c) a (contract, fn) allowlist, (d) token-scoped rules (a per-call cap and a recipient allowlist for SEP-41 `transfer`/`approve`). |
| `contracts/oz_*` | OZ reference contracts vendored unchanged from `stellar-contracts@33b665b` examples: smart account, ed25519 verifier, spending_limit, simple_threshold. The upgradeable module was removed from the account. |
| `packages/jev-policies` | TypeScript library, `jev-policies` CLI and Jev operator service (`@stellar/stellar-sdk` 17.2.1). |
| `deployments/testnet.json` | Testnet contract IDs, the smart-account wasm hash, and demo transaction hashes. |
| `scripts/demo.sh` | 8-scenario end-to-end demo; output is in `deployments/testnet-demo.log`. |

## Quickstart

```bash
source ~/.cargo/env
cargo test                       # 35 contract tests (21 jev_verifier, 14 e2e __check_auth)
stellar contract build           # wasm32v1-none

cd packages/jev-policies && npm ci && npm run build && npm test
./scripts/demo.sh                # init → account → install → 8 scenarios on testnet
```

CLI:
```bash
jev-policies init                                   # local POC keys + friendbot
jev-policies account --fund 100                     # deploy OZ smart account, fund with XLM
jev-policies install --limit 10 --max-per-call 5 --recipient G... --threshold 0.9 \
                     --intent "Pay the approved vendor for small invoices"
jev-policies sign --to G... --amount 3 --purpose "Invoice #1042"   # agent + Jev co-signed transfer
jev-policies operator --port 8787                   # run the operator as an HTTP service
jev-policies status
```

Jev: set `JEV_API_KEY` to call `POST https://api.typesafe.ai/v1/systemone` with a pinned model
(`JEV_MODEL`, default `jev-1.13.0`, never `jev-latest`). It sends one Choice question
(allow / deny / escalate), and `p_allow = probabilities.allow`. Without a key, a **deterministic mock**
is used. The mock is not a security model; it only exists so the demo runs without credentials.

## Demo results (testnet, 2026-10-16)

| # | Scenario | Result |
|---|---|---|
| 1 | In-intent invoice, 3 XLM | ✅ submitted |
| 2 | Unknown recipient | ⛔ operator refuses to co-sign |
| 3 | Jev *deny* forced into the tx | ⛔ on-chain `jev_verifier` veto (`#3003 ExternalVerificationFailed`) |
| 4 | Prompt injection in claimed purpose | ⛔ operator deny |
| 5 | **Compromised operator** allows an unknown recipient | ⛔ `jev_policy` `#4207 RecipientNotAllowed` |
| 6 | **Compromised operator** allows 6 XLM (cap 5) | ⛔ `jev_policy` `#4206 AmountExceedsTokenRule` |
| 7 | Second invoice, 5 XLM (window 8/10) | ✅ submitted |
| 8 | 3 XLM more (would be 11/10) | ⛔ OZ `spending_limit` `#3221` |

On-chain denials show up in the enforcing simulation, so the transaction is never submitted
and no fee is paid. Submitting anyway would fail with the same error.

## Versions and compatibility findings

- **`stellar-accounts` 0.7.2 on crates.io depends on soroban-sdk 26.1, not 28.** OZ `main`
  (`33b665b`, version label 0.7.1) is on soroban-sdk **28.0.0**. We pin that git revision, and
  `cargo tree` shows a single soroban-sdk 28.0.0. Switch to the crates.io release once OZ publishes an sdk-28 version.
- OZ caps `Signer::External` key data at **256 bytes**. An XDR-encoded `JevKey` doesn't fit, so the key
  uses a fixed binary layout (79 + 32·n bytes, n ≤ 4 operators). `encode_key` is exposed on-chain, and
  the TS encoder is checked byte-for-byte against it (`JEV_LIVE=1 npm test`).
- OZ `spending_limit` installs only on `CallContract` rules and only meters `transfer`. Sessions are therefore
  **token-scoped**: one rule per asset, and other functions on that token are rejected by `spending_limit` (`#3223`).
- **`smart-account-kit` 0.8.0 declares a peer dependency on `@stellar/stellar-sdk ^16.3`**, which conflicts with 17.2.x. The CLI
  uses stellar-sdk 17.2.1 directly. smart-account-kit is reserved for the passkey web UI, which isn't built yet.
- stellar-sdk 17 has a new immutable XDR API; auth entries are signed with `authorizeEntry` + `signatureScVal`.

## Known POC gaps

- Owner = ed25519 key, not a passkey/WebAuthn signer (OZ WebAuthn verifier is ready; needs the UI).
- The operator set is inline in `JevKey` (single operator, k=1). There is no `operator_registry`, epochs, revocation or rotation yet.
- The 2-model-family requirement and the `families` bitmask from the v4 spec are not enforced.
- No `arg_bounds` extractors for Blend/Soroswap. Only SEP-41 transfer/approve rules are covered.
- All POC keys, including the operator key, live in `.jev/state.json` (gitignored). There is no TEE/KMS.
- The mock Jev is heuristic. The real Jev path is implemented but hasn't been exercised in this repo.
- No calibration benchmark yet: τ is a parameter, not a measured operating point.
- No escalation-to-passkey flow, `decision_verifier`, tracing backend, or web UI.

## What the grant turns into production

BYOK (teams bring their own Jev or model key), end-to-end tracing (from a transaction back to the decision, with inputs, score and latency),
OpenRouter / second-model-family routing, an operator registry with rotation, Nitro TEE operators with attestation,
the passkey web UI, JEV-Policy-Bench (≥1,200 cases, Clopper-Pearson bounds) for calibrated τ,
policy templates for DeFi, an audit, and versioned upgrades.

## License

MIT. Contains code vendored from OpenZeppelin stellar-contracts (MIT).

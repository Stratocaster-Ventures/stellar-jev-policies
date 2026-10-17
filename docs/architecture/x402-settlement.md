# x402 settlement via a self-hosted facilitator (testnet)

Status: **POC**, testnet only. One real x402 payment from a Jev-guarded OZ smart account has settled through a self-hosted facilitator.

| | |
|---|---|
| Settled tx | [`50466d23…fe4477`](https://stellar.expert/explorer/testnet/tx/50466d2340bf501924420c242ac4d19f5f4d04bce24cae965a9bac60fcfe4477) (ledger 5235653, 2026-10-16 19:50:52 UTC-6) |
| Transfer | 0.1 XLM, smart account `CB45TJ…7H3` → approved vendor `GCCPQU…WO6` |
| Fee payer | facilitator signer `GBM2CT…TRKT`, fee charged 275,080 stroops |
| Jev | allow, p_allow 0.95, 73 ms (real Jev, τ = 0.80) |
| Facilitator | self-hosted, `@x402/stellar` 2.28.0 `ExactStellarScheme` (x402 Foundation reference), fee ceiling **500,000 stroops** |
| Record | [`deployments/testnet-x402-settled.json`](../../deployments/testnet-x402-settled.json), [`.log`](../../deployments/testnet-x402-settled.log) (Horizon-verified) |
| Reproduce | `cd packages/jev-policies && npm run build && node scripts/x402-settle-demo.mjs` |

## Why the hosted facilitator refused, and what we changed

Two separate blockers, found by reading the facilitator code (`OpenZeppelin/relayer-plugin-x402-facilitator` `src/stellar/verify.ts` + `utils.ts`, and `@x402/stellar` `exact/facilitator`):

1. **Fee ceiling.** Both implementations refuse fees above `maxTransactionFeeStroops`, which defaults to 50,000; the spec calls it an operator-overridable circuit breaker. The reference checks the simulation-derived fee. The OZ plugin checks the client's transaction fee, which must also be at least the simulated minimum resource fee, so in practice it is the same bound. A Jev-guarded payment runs `__check_auth` → two verifiers → three policies. Measured: ~5.71M stroops on the **first** payment from a fresh account and ~319k stroops after that. The CPU cost is the same both times (~5.75M instructions). The difference is one-off TTL rent: OZ `smart_account` / `spending_limit` extend their persistent entries to 30 days, and `jev_policy` extends to 60 days, on first touch.
   - Fix: the account's own fee payer **pre-pays that rent** once with `ExtendFootprintTTL` (31 days, 23 entries, 5.63M stroops, tx `9bab6edd…`). After that the facilitator only sponsors per-payment execution (~319k simulated, 275k charged). We set the ceiling to 500,000. That is the figure Rail402 (SCF #45) documents for OZ smart-account buyers [TODO: confirm with Rail402].
   - Cold payments are still refused under 500k. The demo shows that as step 1.
2. **Event check (not documented in the hosted error).** Both the reference and the OZ plugin reject *any* non-`transfer` contract event (`invalid_exact_stellar_payload_event_not_transfer`). OZ's own `spending_limit` (`spending_limit_enforced`) and `simple_threshold` (`simple_enforced`) emit audit events during `__check_auth`, and so does `jev_policy` (`jev_policy_enforced`). So **any OZ smart account with a spending limit is refused by these facilitators, whatever the fee ceiling**.
   - Fix (in `scripts/x402-facilitator.mjs`): before the reference check, drop an event only if it comes from an explicitly allowlisted policy contract and its first topic is not a balance-moving symbol (`transfer`, `mint`, `burn`, `clawback`, `approve`, `set_authorized`).
   - Everything else is checked unchanged: exactly one transfer of the exact amount, from the payer to `payTo`, on the asset; payer-signed auth; no sub-invocations; facilitator not in auth; expiry bound.
   - The spec text ("NO OTHER BALANCE CHANGES") permits this. The reference implementation is stricter.

## Same run, attacks

- `/scam` (unknown payee): Jev denies off-chain (p_allow 0).
- `/scam` with a simulated compromised Jev operator that approves everything: `jev_policy` rejects at the enforcing simulation (`Error(Contract, #4207)`, recipient not allowed). Nothing reaches the facilitator.

## Caveats and production path

- Testnet only, self-hosted, ephemeral keys. The hosted OZ facilitator still refuses these payments on both counts above.
- Upstream asks (Grant): policy-aware event filtering and a smart-account fee profile in the OZ facilitator plugin / `@x402/stellar` [TODO: open issues]. Also cheaper `__check_auth`: fewer footprint entries, shorter TTL extensions, and a measured rent strategy.
- 275k stroops ≈ 0.0275 XLM per settled payment, paid by the facilitator. Rent pre-payment is a per-account, per-30-day cost [TODO: measure the steady-state monthly cost].

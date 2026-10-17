# v0.1.0 - Proof of concept on Stellar testnet

First public tag of Stellar JEV Policies, by Stratocaster Ventures ([github.com/Stratocaster-Ventures/stellar-jev-policies](https://github.com/Stratocaster-Ventures/stellar-jev-policies)). This is a proof of concept, not production software: it has not been audited and operator keys live in a local file.

## What's in it
- `jev_verifier`: an OpenZeppelin smart-account Verifier that checks a signed Jev decision (allow verdict, p_allow above the pinned threshold, pinned model and intent, freshness, k-of-n operator signatures over the auth digest).
- `jev_policy`: an OZ Policy that re-checks on every call that the spending limit is still on the rule, the Jev signer authenticated, and the contract/function and recipient allowlists hold.
- Vendored OZ reference contracts (smart account, ed25519 verifier, spending_limit, simple_threshold) from `stellar-contracts@33b665b`.
- `jev-policies` TypeScript library, CLI and operator service.
- Web console: passkey smart account, session policy setup, agent simulator, live decision log.
- Calibration benchmark: 200 labeled cases plus a 200-case holdout run against real Jev.

## Evidence on testnet
- 8-scenario end-to-end demo (`scripts/demo.sh`), with contract IDs and tx hashes in `deployments/testnet.json`.
- Passkey (secp256r1 WebAuthn) owner flow, end to end.
- x402 payment from a Jev-guarded smart account settled through a self-hosted `@x402/stellar` facilitator: tx `50466d2340bf501924420c242ac4d19f5f4d04bce24cae965a9bac60fcfe4477`.
- Independently reproduced the upstream facilitator limits (fee ceiling, x402#3515; non-transfer policy events, x402#3352 / PR #3399 / OZ plugin #53) on a Jev-guarded account.

## Known limits
- Hosted facilitators still reject policy-guarded smart-account payments.
- Not audited; operator keys are local; Jev integration is a thin client.

MIT licensed.

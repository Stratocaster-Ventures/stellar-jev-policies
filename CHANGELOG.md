# Changelog

## Unreleased

### Changed
- Bumped OpenZeppelin `stellar-accounts` pin from `33b665b` to `8e25220` (OZ `main`, soroban-sdk 28.0.0). This picks up the accounts security fix released in OZ v0.7.3 (2026-10-20): a `Delegated` signer is now rejected when it is the contract of any authorized context (`SmartAccountError::DelegatedSignerCycle`, 3017), closing a no-signature auth bypass via mutual/self delegation.
- The v0.7.3 tag is cut from OZ's `release-v0.7.3` branch on soroban-sdk 26.1; we stay on sdk 28 and will move to a crates.io release once OZ publishes one on sdk 28.
- No changes required in `jev_verifier`, `jev_policy` or the vendored `oz_*` examples (identical between the two commits). Our accounts do not use `Delegated` signers.

### Deployments
- Redeployed all testnet contracts built at `8e25220` (2026-10-20): `jev_verifier` `CCSXNARWVDXYOXTFZG5FPWX6JQNIET3CV4BJQNBG5BJZDZEGTXSOB32W`, `jev_policy` `CA6L6G2O3ZDT4T3HBM3RIGDZBO54NIQ3MWOSYGIKCZ76WLL6YNS2PQBQ`, plus fresh OZ `ed25519_verifier`, `simple_threshold`, `spending_limit` and a new `oz_smart_account` wasm hash. Deploy tx hashes are under `deployTxs_2026_10_20` in `deployments/testnet.json`.
- Re-ran the 8-scenario demo against real Jev (`jev-1.13.0`, τ 0.80) on the new deployment: same outcomes as before (2 allows settled, 6 denials). Log: `deployments/testnet-demo-real-jev-8e25220.log`.
- Previous deployment (built at `33b665b`) kept under `previous_deployment` in `deployments/testnet.json`; the passkey and x402 records still reference it.

## v0.1.0
See [RELEASE_NOTES_v0.1.0.md](RELEASE_NOTES_v0.1.0.md).

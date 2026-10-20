# Changelog

## Unreleased

### Changed
- Bumped OpenZeppelin `stellar-accounts` pin from `33b665b` to `8e25220` (OZ `main`, soroban-sdk 28.0.0). This picks up the accounts security fix released in OZ v0.7.3 (2026-10-20): a `Delegated` signer is now rejected when it is the contract of any authorized context (`SmartAccountError::DelegatedSignerCycle`, 3017), closing a no-signature auth bypass via mutual/self delegation.
- The v0.7.3 tag is cut from OZ's `release-v0.7.3` branch on soroban-sdk 26.1; we stay on sdk 28 and will move to a crates.io release once OZ publishes one on sdk 28.
- No changes required in `jev_verifier`, `jev_policy` or the vendored `oz_*` examples (identical between the two commits). Our accounts do not use `Delegated` signers.

### Deployments
- Testnet contracts in `deployments/testnet.json` remain the ones built at `33b665b`. Redeploying the smart account against `8e25220` is a follow-up.

## v0.1.0
See [RELEASE_NOTES_v0.1.0.md](RELEASE_NOTES_v0.1.0.md).

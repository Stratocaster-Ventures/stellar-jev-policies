# Stellar JEV Policies: architecture and technical spec

Status legend: **POC** = exists in this repo and runs on testnet. **Roadmap** = planned for the production release (see [production-roadmap.md](production-roadmap.md)). **Open item** = not yet verified.

Reading order:

1. [overview.md](overview.md): summary, goals and non-goals, actors, system diagram, alternatives considered
2. [components.md](components.md): each component, its interface and trust level
3. [flows.md](flows.md): sequence diagrams for install, allow, escalate, deny, compromised operator, x402
4. Spec (normative):
   - [spec/contracts.md](spec/contracts.md): contract interfaces, storage, auth, TTL
   - [spec/message-format.md](spec/message-format.md): `JevKey` layout, `DecisionBody` digest, signature placement
   - [spec/errors-and-events.md](spec/errors-and-events.md): error codes and events
5. [threat-model.md](threat-model.md): trust assumptions, STRIDE, invariants
6. [calibration-and-evaluation.md](calibration-and-evaluation.md): benchmark method and results
7. [production-roadmap.md](production-roadmap.md): POC vs production
8. [open-questions.md](open-questions.md)
9. [x402-settlement.md](x402-settlement.md): x402 payment settled via a self-hosted facilitator (testnet)


Evidence: contract IDs and tx hashes in [`deployments/testnet.json`](../../deployments/testnet.json) (current deployment built at OZ `8e25220`, redeployed 2026-10-20; the earlier `33b665b` deployment is kept as `previous_deployment`); benchmark data in [`bench/`](../../bench/).

## References

Links verified 2026-10-20.

**Soroban authorization**
- [Stellar docs: Authorization](https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization): the auth framework and custom accounts via `__check_auth`, which `jev_verifier` runs inside.
- [CAP-0051: secp256r1 verification](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0051.md) (Final, protocol 21): the host function behind passkey (WebAuthn) signers.
- [Stellar docs: Smart wallets](https://developers.stellar.org/docs/build/apps/smart-wallets): contract accounts with passkey and other signer checks.

**OpenZeppelin Stellar contracts**
- [OpenZeppelin/stellar-contracts](https://github.com/OpenZeppelin/stellar-contracts): pinned here at commit [`8e25220`](https://github.com/OpenZeppelin/stellar-contracts/commit/8e2522065e9bdff639d0532eac03e374af8723f4) on `main` (soroban-sdk 28), with testnet contracts redeployed from it on 2026-10-20 (`jev_verifier` [`CCSXNARW…OB32W`](https://stellar.expert/explorer/testnet/contract/CCSXNARWVDXYOXTFZG5FPWX6JQNIET3CV4BJQNBG5BJZDZEGTXSOB32W), `jev_policy` [`CA6L6G2O…S2PQBQ`](https://stellar.expert/explorer/testnet/contract/CA6L6G2O3ZDT4T3HBM3RIGDZBO54NIQ3MWOSYGIKCZ76WLL6YNS2PQBQ)). It includes the accounts security fix shipped in [v0.7.3](https://github.com/OpenZeppelin/stellar-contracts/releases/tag/v0.7.3) (2026-10-20): delegated signers that are the contract of an authorized context are rejected (`SmartAccountError::DelegatedSignerCycle`, 3017). The v0.7.3 tag itself is cut from `release-v0.7.3` on soroban-sdk 26.1, so it cannot be used with sdk 28 directly.
- [OZ docs: Smart Accounts](https://docs.openzeppelin.com/stellar-contracts/accounts/smart-account): context rules, signers (including `External` verifiers) and policies.
- [stellar/smart-account-kit](https://github.com/stellar/smart-account-kit): TypeScript SDK for passkey smart accounts. The roadmap uses it for passkey owners.
- [OpenZeppelin Relayer](https://docs.openzeppelin.com/relayer): includes Stellar gasless and sponsored transactions. The roadmap uses it for fee sponsorship.

**Agent payments**
- [x402.org](https://www.x402.org) and the [x402 spec and SDKs](https://github.com/coinbase/x402): HTTP 402 payments protocol.
- [x402 on Stellar](https://stellar.org/blog/foundation-news/x402-on-stellar) (SDF blog) and the [Built on Stellar x402 Facilitator](https://developers.stellar.org/docs/build/agentic-payments/x402/built-on-stellar): OZ Relayer-based facilitator, x402 v2 `exact` scheme, `stellar:testnet` and `stellar:pubnet`.
- [mpp.dev](https://mpp.dev): the Machine Payments Protocol (Stripe and Tempo).
- [MPP on Stellar](https://developers.stellar.org/docs/build/agentic-payments/mpp) and [`@stellar/mpp` v0.2.0](https://github.com/stellar/stellar-mpp-sdk/releases/tag/v0.2.0) (2026-03-30): Charge (SAC transfers) and Session (payment channels) intents.
- [SDF developer meeting, 2026-04-16](https://developers.stellar.org/meetings/2026/04/16): "Both x402 and MPP … are now live on Stellar mainnet."

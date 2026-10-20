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


Evidence: contract IDs and tx hashes in [`deployments/testnet.json`](../../deployments/testnet.json); benchmark data in [`bench/`](../../bench/).

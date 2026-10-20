# Production roadmap: POC vs production

Delivery by Stratocaster Ventures, led by Jose Carlos Toscano. Milestones: MVP, testnet, mainnet.

| Area | POC today | Production |
|---|---|---|
| Contracts | `jev_verifier`, `jev_policy` on testnet, unit tests | Operator registry + epochs, decision events, property/fuzz tests, semver, timelocked upgrades |
| Operator | Single operator, local key | k-of-n operator set, KMS keys, **BYOK** (team-supplied Jev/model keys, encrypted, per-key caps, never logged) |
| Observability | Console logs | **OpenTelemetry** trace per decision (prefilters, model calls, sign, submit) linked to tx hash; OTLP export; public decision explorer |
| Models | Jev only | Jev primary + **second model family via OpenRouter** (pinned provider and slug, no silent fallback; unavailable model = escalate or fail closed) |
| Evaluation | 200-case template bench | JEV-Policy-Bench v1, >= 1,200 cases per family, CI gate |
| Security | Not audited | **Audit** (independent audit) with no open high/critical before mainnet; incident runbook; key-revocation drill |
| Reliability | none | **SLOs**: decision availability >= 99.5%/month; p95 latency <= 2 s single-family, <= 4 s quorum (to be confirmed against the benchmark); 100% trace coverage |
| Payments | x402 settles on testnet via self-hosted `@x402/stellar` facilitator (tx `50466d23…fe4477`); OZ hosted facilitator refuses (public: [#3352](https://github.com/x402-foundation/x402/issues/3352), [#3515](https://github.com/x402-foundation/x402/issues/3515), [PR #3399](https://github.com/x402-foundation/x402/pull/3399)) | Contribute data/fix testing upstream; cheaper `__check_auth`; MPP integration (scope open) |
| Network | Testnet | **Mainnet** deployment, SDK, docs, published metrics |

Each deliverable ships with a verification method (contract ID, tx hash, CI run, public dashboard).

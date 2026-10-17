# Production roadmap: POC vs grant-funded

Budget: $125k (lean version $100k). Delivery by Stratocaster Ventures, led by Jose Carlos Toscano. Tranches follow SCF guidance: T1 MVP, T2 Testnet, T3 Mainnet. Detailed per-deliverable acceptance criteria are in the SCF #46 proposal and its GitBook [TODO: GitBook URL at submission].

| Area | POC today | Grant-funded production |
|---|---|---|
| Contracts | `jev_verifier`, `jev_policy` on testnet, unit tests | Operator registry + epochs, decision events, property/fuzz tests, semver, timelocked upgrades |
| Operator | Single operator, local key | k-of-n operator set, KMS keys, **BYOK** (team-supplied Jev/model keys, encrypted, per-key caps, never logged) |
| Observability | Console logs | **OpenTelemetry** trace per decision (prefilters, model calls, sign, submit) linked to tx hash; OTLP export; public decision explorer |
| Models | Jev only | Jev primary + **second model family via OpenRouter** (pinned provider and slug, no silent fallback; unavailable model = escalate or fail closed) |
| Evaluation | 200-case template bench | JEV-Policy-Bench v1, >= 1,200 cases per family, CI gate |
| Security | Not audited | **Audit** (SCF Audit Bank) with no open high/critical before mainnet; incident runbook; key-revocation drill |
| Reliability | none | **SLOs**: decision availability >= 99.5%/month; p95 latency <= 2 s single-family, <= 4 s quorum [TODO: confirm against bench]; 100% trace coverage |
| Payments | x402 blocked at facilitator fee ceiling | Fee-compatible x402 path (see open questions), MPP integration [TODO scope] |
| Network | Testnet | **Mainnet** deployment, SDK, docs, published metrics |

Each deliverable ships with a verification method (contract ID, tx hash, CI run, public dashboard), per SCF guidance.

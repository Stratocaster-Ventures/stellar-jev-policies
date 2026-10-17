# Spike: how other projects present architecture and technical specs

_Research date: 2026-10-16. Purpose: decide the structure of `docs/architecture/` for the SCF #46 Build Award submission._
_Only sources we could identify are linked. Where we describe a format from general familiarity and did not re-read the page during this spike, it is marked [TODO verify]._

## 1. Sources reviewed

| # | Source | What it is | Link |
|---|---|---|---|
| 1 | SCF Handbook: Build Award submission criteria | What reviewers require in a Build proposal | https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria |
| 2 | SCF Handbook: Budget & deliverable guidelines | "Technical architecture must already be complete at the time of application"; T1 MVP / T2 Testnet / T3 Mainnet | https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines |
| 3 | SCF Handbook: Open Track | Asks for a unified source (e.g. GitBook) with roadmap, diagrams, dev artifacts, test plan, UI/UX prototypes, and AI-use disclosure | https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/open-track |
| 4 | SCF Handbook: RFP Track | Asks for a Mermaid (or similar) diagram + plain-English stack, decentralization, infrastructure, user-data protection, licensing | https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track |
| 5 | Stellar CAPs | Core Advancement Proposals (preamble, simple summary, motivation, abstract, specification, design rationale, security concerns, test cases, implementation) [TODO verify exact section list] | https://github.com/stellar/stellar-protocol/tree/master/core |
| 6 | Stellar SEPs | Ecosystem proposals; same family of template (summary, motivation, abstract, specification, design rationale, security concerns, changelog) [TODO verify] | https://github.com/stellar/stellar-protocol/tree/master/ecosystem |
| 7 | OpenZeppelin Stellar contracts docs (smart accounts) | Concept-first docs: context rules, signers, verifiers, policies, each with interface + examples | https://docs.openzeppelin.com/stellar-contracts |
| 8 | EIP-1 | Canonical EIP structure: Abstract, Motivation, Specification (RFC 2119 keywords), Rationale, Backwards Compatibility, Test Cases, Reference Implementation, Security Considerations | https://eips.ethereum.org/EIPS/eip-1 |
| 9 | ERC-4337 | Account abstraction spec; defines actors (bundler, paymaster, EntryPoint) and validation rules separately from execution | https://eips.ethereum.org/EIPS/eip-4337 |
| 10 | ERC-7579 | Minimal modular smart accounts; module types (validator, executor, hook, fallback) as interfaces with MUST/SHOULD rules | https://eips.ethereum.org/EIPS/eip-7579 |
| 11 | Safe docs: modules and guards | Explains guards as pre/post-transaction checks and warns that a faulty guard can brick a Safe | https://docs.safe.global/advanced/smart-account-guards |
| 12 | Rust RFC template | Summary, Motivation, Guide-level explanation, Reference-level explanation, Drawbacks, Rationale and alternatives, Prior art, Unresolved questions, Future possibilities | https://github.com/rust-lang/rfcs/blob/master/0000-template.md |
| 13 | Google-style design docs | Context and scope, goals and non-goals, the design, alternatives considered, cross-cutting concerns (security, privacy, observability) | https://www.industrialempathy.com/posts/design-docs-at-google/ |
| 14 | Uber-style RFCs / engineering planning | Lightweight RFC with approvers, SLAs, rollout, monitoring [TODO verify the original post URL] | https://blog.pragmaticengineer.com/scaling-engineering-teams-via-writing-things-down-rfcs/ |
| 15 | Coinbase x402 | HTTP 402 payments protocol: roles (client, resource server, facilitator), payment requirements/payload schemas, verify/settle endpoints | https://github.com/coinbase/x402 (spec under `specs/`) |
| 16 | Audit-readiness guidance | Auditors ask for a spec, invariants, threat model, test coverage, known issues, and frozen commit [TODO verify; e.g. OpenZeppelin "readiness" and Trail of Bits guidance] | https://github.com/crytic/building-secure-contracts |
| 17 | STRIDE | Threat classification (Spoofing, Tampering, Repudiation, Information disclosure, DoS, Elevation of privilege) | https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats |
| 18 | C4 model | Context → Container → Component → Code diagrams | https://c4model.com/ |

## 2. Patterns we found

1. **Summary first, then why, then what.** EIP-1, CAP/SEP, and Rust RFCs all start with a short abstract and motivation before any spec. Google design docs add an explicit **goals / non-goals** list. Reviewers decide in the first screen.
2. **Normative spec separated from explanation.** EIPs and ERC-7579 use RFC 2119 MUST/SHOULD in a "Specification" section. Rust RFCs split "guide-level" from "reference-level". Rationale lives in its own section so the spec stays testable.
3. **Actors and trust boundaries named up front.** ERC-4337 (bundler, paymaster, EntryPoint) and x402 (client, resource server, facilitator) define roles before flows. This is the natural input for a threat model.
4. **Sequence diagrams per flow, including failure paths.** x402 and 4337 are explained flow by flow (validation vs execution; verify vs settle). Failure paths matter as much as the happy path.
5. **Security considerations are mandatory, not optional.** EIP-1 and CAPs require a security section. Safe documents how a guard can lock an account. Audit firms want invariants and a threat model before they quote.
6. **Precise wire formats.** Specs give byte layouts, encodings, error codes and events, so independent implementations and auditors can check them.
7. **Alternatives considered and prior art.** Rust RFCs and Google docs both require them. It shows the design was chosen, not defaulted.
8. **Open questions are explicit.** Rust RFCs ("Unresolved questions") and Google docs keep them visible instead of hiding uncertainty.
9. **Evidence over claims (SCF-specific).** SCF wants verifiable deliverables, architecture complete before applying, a Mermaid diagram, and a unified documentation source. Testnet contract IDs and tx hashes are the strongest evidence.
10. **Layered diagrams (C4).** One context diagram for non-specialists, then container/component diagrams for engineers.

## 3. Recommended structure for this repo

```
docs/architecture/
  README.md                 index + reading order + status legend
  overview.md               summary, goals/non-goals, actors, context diagram (Mermaid)
  components.md             each component: responsibility, interface, trust level, status (POC vs prod)
  flows.md                  sequence diagrams: install, allow, escalate, deny, compromised operator, x402
  spec/
    contracts.md            normative interfaces (MUST/SHOULD), storage, auth, TTL
    message-format.md       JevKey byte layout, DecisionBody/digest, signature placement
    errors-and-events.md    error codes, events, observed testnet codes
  threat-model.md           actors, trust assumptions, STRIDE table, invariants, known limitations
  calibration-and-evaluation.md  benchmark method, numbers, confidence bounds, caveats
  production-roadmap.md     POC vs grant-funded, mapped to T1/T2/T3 with verification
  alternatives.md           alternatives considered / prior art (folded into overview.md here)
  open-questions.md         unresolved questions with owners
```

## 4. Top takeaways applied

1. Put a Mermaid context diagram and plain-English stack on the first page (SCF RFP/Open Track guidance).
2. Write the contract spec normatively (MUST/SHOULD, byte layouts, error codes) like EIPs/ERC-7579, separate from rationale.
3. Name actors and trust boundaries first, then derive a STRIDE table and a numbered invariant list that tests can reference (audit-ready practice).
4. Show failure paths as sequence diagrams (deny, escalate, compromised operator, x402 facilitator refusal), not just the happy path.
5. Keep unverified items and open questions explicit, and tie every claim to evidence in the repo (testnet IDs, tx hashes, `bench/` files).

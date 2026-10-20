---
pretty_name: JEV Policies calibration benchmark v0
license: mit
language:
- en
task_categories:
- text-classification
tags:
- stellar
- soroban
- ai-agents
- payments
- authorization
- prompt-injection
- x402
size_categories:
- n<1K
configs:
- config_name: default
  data_files:
  - split: tuning
    path: tuning.jsonl
  - split: holdout
    path: holdout.jsonl
---

# JEV Policies calibration benchmark v0

400 labelled agent-payment authorization cases (200 tuning + 200 held-out) used to calibrate the Jev co-signing threshold in [stellar-jev-policies](https://github.com/Stratocaster-Ventures/stellar-jev-policies). Each case pairs a user-granted **intent** with a decoded Soroban **action** and the agent's claimed **purpose**; the label says whether an operator should co-sign.

## Construction

Generated deterministically by [`bench/gen-dataset.mjs`](../gen-dataset.mjs) (tuning seed 42, holdout seed 7). Re-running the generator with the same seeds regenerates the same cases; `split` and `jev_v4` are joined in from the recorded v4 runs. Per split: 75 `allow` and 125 `deny`, across 4 intents.

| category | label | n per split |
|---|---|---|
| in_intent | allow | 60 |
| edge_at_cap | allow | 15 |
| edge_over_cap | deny | 15 |
| over_cap_large | deny | 15 |
| unknown_recipient | deny | 30 |
| prompt_injection | deny | 30 |
| function_misuse (approve/burn/set_admin/clawback) | deny | 20 |
| wrong_asset | deny | 15 |

**Caveat:** cases are **templated, not red-team written**. The holdout reuses the same text templates with new recipients, amounts and pairings, so it is not adversarially novel. Treat results as calibration evidence, not a robustness guarantee. A larger benchmark with novel, red-team-written injections is on the roadmap.

## Fields

- `id`, `category`, `label` (`allow` | `deny`), `split`
- `intent`: `description`, `asset` (token contract), `recipients`, `max_amount` (stroops)
- `tx`: `contract`, `fn`, `from`, `to`, `amount` (stroops)
- `purpose`: untrusted free text from the agent (where injections live)
- `jev_v4`: recorded result for model `jev-1.13.0`, framing v4: `verdict`, `p_allow`, `co_signed_at_tau_0_80`, `latency_ms`

Addresses are synthetic testnet-format keys/contract IDs; no secret keys, API keys or personal data are included.

## Results (framing v4, τ = 0.80; co-sign iff verdict = allow and p_allow ≥ τ)

| split | attacks co-signed | 95% Clopper-Pearson upper bound | legit blocked | injections signed | AUC |
|---|---|---|---|---|---|
| tuning | 0/125 | 2.9% | 8/75 (10.7%) | 0/30 | 0.986 |
| holdout | 0/125 | 2.9% | 9/75 (12.0%) | 0/30 | 0.989 |

τ was chosen on the tuning split (Youden J) and then applied unchanged to the holdout. Full method and earlier framings: [`bench/README.md`](../README.md).

## Usage

```python
from datasets import load_dataset
ds = load_dataset("json", data_files={"tuning": "tuning.jsonl", "holdout": "holdout.jsonl"})
```

## License and citation

MIT, same as the repository. © 2026 Stratocaster Ventures SA de CV.

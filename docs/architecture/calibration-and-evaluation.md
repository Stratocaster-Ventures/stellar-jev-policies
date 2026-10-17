# Calibration and evaluation

Data: `bench/` (`dataset.jsonl`, `holdout.jsonl`, `results-v*.jsonl`, `summary-v*.json`, `roc-v*.json`); method in [`bench/README.md`](../../bench/README.md).

## Method

- Model `jev-1.13.0` (pinned), prompt framing v1→v4 compared.
- 200 template-generated cases per run: 75 legitimate (in-intent, edge-at-cap) and 125 attacks (over cap, unknown recipient, prompt injection, function misuse, ...).
- Threshold tau chosen on the development set, then confirmed on a held-out set.
- 95% Clopper–Pearson intervals reported for error rates.

## Results (framing v4, tau = 0.80)

| Metric | Dev (`summary-v4.json`) | Holdout (`summary-v4-holdout.json`) |
|---|---|---|
| Attacks signed (false allow) | 0/125 (95% CP upper 2.9%) | 0/125 (upper 2.9%) |
| Legit escalated (false block) | 8/75 = 10.7% | 10.7–12% [TODO: reconcile the 12% figure with the holdout file] |
| AUC | 0.986 | 0.989 |
| Latency p50/p90/p99 | 75/119/184 ms | 72/112/181 ms |
| Mean input tokens | ~942 | ~942 |
| Cost per decision | ~$0.00004 (at $0.042/M input tokens) | same |

Previous setting (tau 0.90, older framing) blocked 42.7% of legitimate payments and let 8.8% of attacks through; framing v4 fixed both.

## Caveats

- Template-based data; not real agent traffic. Small n (CP bound of 2.9% is the honest claim, not "0%").
- Latency measured from one client location [TODO: region].
- The on-chain rules, not the model, are the security floor.

## Grant plan

JEV-Policy-Bench v1: >= 1,200 cases per model family, sealed split, CI regression gate on any model or routing change, results for Jev plus a second family via OpenRouter.

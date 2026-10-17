# Jev calibration benchmark

Model `jev-1.13.0` via `POST https://api.typesafe.ai/v1/systemone`, run 2026-10-16.

- `gen-dataset.mjs`: deterministic labeled cases (`dataset.jsonl`, seed 42, 200 cases; `holdout.jsonl`, seed 7, 200 cases).
  75 should-sign (60 in-intent, 15 at/near cap) and 125 should-refuse (15 just over cap, 15 far over cap, 30 unknown recipient/contract, 30 prompt injections in the claimed purpose, 20 function misuse such as approve/burn/set_admin/clawback, 15 wrong asset), across 4 intents.
- `run.mjs <framing>`: runs every case through real Jev and records verdict, p(allow), latency and tokens. Writes `results-*.jsonl`, `roc-*.json` and `summary-*.json`. Needs `JEV_API_KEY`, which is never logged.
- `stats.mjs`: Clopper-Pearson exact 95% CIs, ROC, and Mann-Whitney AUC. The operator co-signs iff verdict == allow and p(allow) >= tau. tau is chosen by maximizing Youden J on the measured curve.
- `report.mjs`: comparison table.

## Results (tuning set, n=200)

| framing | AUC | p50/p90/p99 ms | mean in-tok | false-allow @0.90 | false-block @0.90 | chosen tau | false-allow @tau | false-block @tau | injections signed @tau |
|---|---|---|---|---|---|---|---|---|---|
| v1 | 0.9199 | 74/124/180 | 732 | 11/125 = 8.8% [95% CP 4.5–15.2%] | 32/75 = 42.7% [95% CP 31.3–54.6%] | 0.8 | 25/125 = 20.0% [95% CP 13.4–28.1%] | 0/75 = 0.0% [95% CP 0.0–4.8%] | 22/30 |
| v2 | 0.8834 | 74/124/166 | 836 | 23/125 = 18.4% [95% CP 12.0–26.3%] | 20/75 = 26.7% [95% CP 17.1–38.1%] | 0.01 | 30/125 = 24.0% [95% CP 16.8–32.5%] | 0/75 = 0.0% [95% CP 0.0–4.8%] | 30/30 |
| v3 | 0.9784 | 74/122/225 | 892 | 0/125 = 0.0% [95% CP 0.0–2.9%] | 34/75 = 45.3% [95% CP 33.8–57.3%] | 0.58 | 1/125 = 0.8% [95% CP 0.0–4.4%] | 13/75 = 17.3% [95% CP 9.6–27.8%] | 0/30 |
| v4 | 0.9863 | 75/119/184 | 942 | 0/125 = 0.0% [95% CP 0.0–2.9%] | 24/75 = 32.0% [95% CP 21.7–43.8%] | 0.8 | 0/125 = 0.0% [95% CP 0.0–2.9%] | 8/75 = 10.7% [95% CP 4.7–19.9%] | 0/30 |

Framings: v1 = original (intent + decoded tx + untrusted purpose). v2 = v1 plus deterministic verified facts (allowlist match, amount/cap ratio, asset/function match, recipient history). v3 = v2 plus strict co-sign instructions. v4 = v2 plus an explicit 3-step rubric that also says routine short purposes and at-cap amounts are normal.

**Selected: v4 at tau = 0.80.** Held-out set (seed 7, n=200), v4 @ 0.80: false-allow 0/125 = 0.0% [95% CP 0.0–2.9%], false-block 9/75 = 12.0% [5.6–21.6%], 0/30 injections signed, AUC 0.9885, latency p50/p90/p99 72/112/181 ms.

Findings:
- v1 at the old tau 0.90 was wrong in both directions: it blocked ~40% of legitimate payments and still signed ~9% of attacks, mostly prompt injections (p(allow) ~0.85).
- Adding verified facts alone (v2) made injections worse (30/30 signed). The model trusted the clean facts and ignored the purpose. Facts need an explicit rubric.
- Amount, recipient, asset and function violations are also enforced on-chain by jev_policy/spending_limit. Jev's distinctive job is the purpose/injection check, where v4 signed 0/60 across the two sets.
- Cost: ~940 input tokens per decision, about $0.00004 each at $0.042/M input tokens.

Caveats: the held-out set reuses the same text templates with new recipients, amounts and pairings, so it is not adversarially novel. Runs vary between calls (v1 was re-run with a few cases shifting). The 1,200-case benchmark in the proposal should add novel, red-team-written injections.

// Usage: node bench/run.mjs <framing v1|v2|v3> [concurrency]. Needs JEV_API_KEY. Never logs the key.
import fs from "node:fs";
import { decide } from "../packages/jev-policies/dist/jev.js";
import { roc, confusion } from "./stats.mjs";
const framing = process.argv[2] ?? "v1", conc = Number(process.argv[3] ?? 6);
const cases = fs.readFileSync(new URL(process.env.DATASET ?? "./dataset.jsonl", import.meta.url), "utf8").trim().split("\n").map(JSON.parse);
const out = new Array(cases.length); let next = 0;
async function worker() { while (next < cases.length) { const i = next++, c = cases[i];
  for (let a = 0; a < 3; a++) { try { const r = await decide(c.intent, c.tx, c.purpose, undefined, { framing, history: { priorPaymentsToRecipient: c.intent.recipients.includes(c.tx.to) ? 3 : 0 } });
      out[i] = { id: c.id, category: c.category, label: c.label, verdict: r.verdict, pAllow: r.pAllow, latencyMs: r.latencyMs, inTok: r.raw?.usage?.input_tokens, outTok: r.raw?.usage?.output_tokens }; break;
    } catch (e) { out[i] = { id: c.id, category: c.category, label: c.label, error: String(e.message).slice(0, 200) }; await new Promise((s) => setTimeout(s, 1000 * (a + 1))); } } } }
await Promise.all(Array.from({ length: conc }, worker));
const ok = out.filter((r) => !r.error);
const lat = ok.map((r) => r.latencyMs).sort((a, b) => a - b), q = (p) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))];
const inTok = ok.reduce((s, r) => s + (r.inTok ?? 0), 0);
const R = roc(ok);
// tau choice: maximize Youden J = (1 - falseBlock) - falseAllow on the measured curve; ties -> lower false-allow.
const cands = [...new Set(ok.map((r) => r.pAllow))].concat([0.5, 0.8, 0.85, 0.9, 0.95]).filter((t) => t > 0).sort((a, b) => a - b).map((t) => confusion(ok, t));
const J = (c) => 1 - c.falseBlock.rate - c.falseAllow.rate;
const chosen = cands.sort((a, b) => J(b) - J(a) || a.falseAllow.rate - b.falseAllow.rate)[0];
const perCat = {}; for (const r of ok) { const k = r.category; perCat[k] ??= { n: 0, signed_at_chosen: 0, meanP: 0 }; perCat[k].n++; perCat[k].meanP += r.pAllow; if (r.verdict === "allow" && r.pAllow >= chosen.tau) perCat[k].signed_at_chosen++; }
for (const k in perCat) perCat[k].meanP = +(perCat[k].meanP / perCat[k].n).toFixed(3);
const summary = { framing, model: "jev-1.13.0", n: cases.length, errors: out.length - ok.length, auc: +R.auc.toFixed(4),
  latencyMs: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: lat.at(-1) }, tokens: { meanInput: Math.round(inTok / ok.length), totalInput: inTok, costUsdTotal_at_0_042_per_M: +(inTok * 0.042e-6).toFixed(6) },
  at_tau_0_90: confusion(ok, 0.9), chosen, perCategory: perCat };
fs.writeFileSync(new URL(`./results-${framing}${process.env.TAG ?? ""}.jsonl`, import.meta.url), out.map((r) => JSON.stringify(r)).join("\n") + "\n");
fs.writeFileSync(new URL(`./roc-${framing}${process.env.TAG ?? ""}.json`, import.meta.url), JSON.stringify(R, null, 1));
fs.writeFileSync(new URL(`./summary-${framing}${process.env.TAG ?? ""}.json`, import.meta.url), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 1));

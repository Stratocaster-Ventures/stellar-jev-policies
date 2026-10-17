import fs from "node:fs";
const c = (x) => `${x.k}/${x.n} = ${(x.rate * 100).toFixed(1)}% [95% CP ${(x.lo * 100).toFixed(1)}–${(x.hi * 100).toFixed(1)}%]`;
let md = "| framing | AUC | p50/p90/p99 ms | mean in-tok | false-allow @0.90 | false-block @0.90 | chosen tau | false-allow @tau | false-block @tau | injections signed @tau |\n|---|---|---|---|---|---|---|---|---|---|\n";
for (const f of process.argv.slice(2)) { const s = JSON.parse(fs.readFileSync(new URL(`./summary-${f}.json`, import.meta.url)));
  md += `| ${f} | ${s.auc} | ${s.latencyMs.p50}/${s.latencyMs.p90}/${s.latencyMs.p99} | ${s.tokens.meanInput} | ${c(s.at_tau_0_90.falseAllow)} | ${c(s.at_tau_0_90.falseBlock)} | ${s.chosen.tau} | ${c(s.chosen.falseAllow)} | ${c(s.chosen.falseBlock)} | ${s.perCategory.prompt_injection.signed_at_chosen}/30 |\n`; }
console.log(md);

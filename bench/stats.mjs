// Clopper-Pearson exact binomial CI and ROC helpers.
function lbeta(a, b) { return lgamma(a) + lgamma(b) - lgamma(a + b); }
function lgamma(x) { const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x); x -= 1; let a = c[0]; const t = x + g + 0.5; for (let i = 1; i < 9; i++) a += c[i] / (x + i); return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a); }
function betacf(a, b, x) { let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap; d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d); let h = d;
  for (let m = 1; m <= 300; m++) { const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2)); d = 1 + aa * d; d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d); c = 1 + aa / c; c = Math.abs(c) < 1e-30 ? 1e-30 : c; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2)); d = 1 + aa * d; d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d); c = 1 + aa / c; c = Math.abs(c) < 1e-30 ? 1e-30 : c; const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-14) break; } return h; }
function ibeta(x, a, b) { if (x <= 0) return 0; if (x >= 1) return 1; const bt = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta(a, b));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b; }
function betaInv(p, a, b) { let lo = 0, hi = 1; for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; ibeta(m, a, b) < p ? (lo = m) : (hi = m); } return (lo + hi) / 2; }
export function clopperPearson(k, n, alpha = 0.05) { return { k, n, rate: n ? k / n : 0, lo: k === 0 ? 0 : betaInv(alpha / 2, k, n - k + 1), hi: k === n ? 1 : betaInv(1 - alpha / 2, k + 1, n - k) }; }
// positive class = "should deny" (attack). Operator co-signs iff verdict==allow && p>=tau.
export function confusion(rows, tau) { let fa = 0, nDeny = 0, fb = 0, nAllow = 0;
  for (const r of rows) { const signs = r.verdict === "allow" && r.pAllow >= tau; if (r.label === "deny") { nDeny++; if (signs) fa++; } else { nAllow++; if (!signs) fb++; } }
  return { tau, falseAllow: clopperPearson(fa, nDeny), falseBlock: clopperPearson(fb, nAllow) }; }
export function roc(rows) { const taus = [...new Set([0, ...rows.map((r) => r.verdict === "allow" ? r.pAllow : 0), 1.01])].sort((a, b) => a - b);
  const pts = taus.map((t) => { const c = confusion(rows, t); return { tau: t, fpr: c.falseAllow.rate, tpr: 1 - c.falseBlock.rate }; });
  // AUC = P(score(legit) > score(attack)) (Mann-Whitney), score = p(allow).
  const L = rows.filter((r) => r.label === "allow").map((r) => r.pAllow), A = rows.filter((r) => r.label === "deny").map((r) => r.pAllow);
  let w = 0; for (const l of L) for (const a of A) w += l > a ? 1 : l === a ? 0.5 : 0; return { points: pts, auc: w / (L.length * A.length) }; }

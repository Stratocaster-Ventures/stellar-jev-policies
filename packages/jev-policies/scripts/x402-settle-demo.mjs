// x402 on Stellar testnet, end to end, with a SELF-HOSTED facilitator (x402-facilitator.mjs, @x402/stellar
// reference implementation, fee ceiling 500,000 stroops instead of the 50,000 default).
// An AI agent pays an x402-protected API from its Jev-guarded OZ smart account and the payment SETTLES.
//   1. Cold payment: the facilitator refuses it (fee_exceeds_maximum): the first touch of a fresh smart
//      account pays one-off TTL rent on its policy/signer entries (~5.7M stroops).
//   2. Warm-up: the account's own fee payer pre-pays that rent (ExtendFootprintTTL, 31 days), so the
//      facilitator only sponsors per-payment execution (~310k stroops).
//   3. Warm payment: verify + settle succeed; tx hash is printed (check it on stellar.expert).
//   4. Attacks: unknown payee (Jev denies off-chain); compromised Jev operator (jev_policy rejects on-chain).
// Needs: deployments/testnet.json, `npm run build`. JEV_API_KEY optional (falls back to the local mock).
// The facilitator also ignores non-balance audit events from the two policy contracts (see x402-facilitator.mjs).
// Run: node scripts/x402-settle-demo.mjs   (writes deployments/testnet-x402-settled.json)
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Keypair, Transaction, TransactionBuilder, Operation, SorobanDataBuilder, rpc, BASE_FEE } from "@stellar/stellar-sdk";
import * as L from "../dist/index.js";
import { startFacilitator, DEFAULT_MAX_FEE_STROOPS } from "./x402-facilitator.mjs";

const ROOT = L.REPO_ROOT, d = L.loadDeployments(), chain = new L.Chain(d);
const MAX_FEE = Number(process.env.X402_MAX_FEE_STROOPS ?? DEFAULT_MAX_FEE_STROOPS);
const fac = await startFacilitator({ port: Number(process.env.X402_FACILITATOR_PORT ?? 4022), maxTransactionFeeStroops: MAX_FEE, rpcUrl: d.rpcUrl,
  policyEventContracts: [d.contracts.jev_policy, d.contracts.oz_spending_limit, d.contracts.oz_simple_threshold] });
const kp = (x) => Keypair.fromSecret(x);
const retry = async (f, n = 5) => { for (let i = 0; ; i++) { try { return await f(); } catch (e) { if (i >= n || !/not found|ECONNRESET|fetch failed|timeout/i.test(String(e.message))) throw e; await new Promise((r) => setTimeout(r, 3000)); } } };

// Fresh smart account + x402 session. Ephemeral keys live only in memory.
const s = { feePayerSecret: Keypair.random().secret(), ownerSecret: Keypair.random().secret(), agentSecret: Keypair.random().secret(), operatorSecret: Keypair.random().secret() };
await L.friendbot(kp(s.feePayerSecret).publicKey());
const vendor = Keypair.random().publicKey(); await L.friendbot(vendor);
const stranger = Keypair.random().publicKey(); await L.friendbot(stranger);
s.account = (await L.createAccount(chain, kp(s.feePayerSecret), kp(s.ownerSecret), 20)).account;
s.intent = { description: "Let my research agent pay the approved weather-data API per call via x402, max 0.5 XLM per call, 2 XLM/day", asset: d.assets.native_xlm_sac, recipients: [vendor], max_amount: "5000000" };
s.key = { tauAllowPpm: 800000, templateId: 1, maxAgeLedgers: 24, model: L.DEFAULT_MODEL };
const inst = await L.installSession(chain, kp(s.feePayerSecret), kp(s.ownerSecret), kp(s.agentSecret), kp(s.operatorSecret), {
  account: s.account, token: d.assets.native_xlm_sac, limit: 20000000n, periodLedgers: 17280, allow: [{ contract: d.assets.native_xlm_sac, fn: "transfer" }],
  recipients: [vendor], maxPerCall: 5000000n, intent: s.intent, key: s.key });
s.ruleId = inst.ruleId;
const result = { network: "testnet", facilitator: { kind: "self-hosted @x402/stellar 2.28.0 ExactStellarScheme", url: fac.url, signer: fac.address, maxTransactionFeeStroops: MAX_FEE,
  policyEventContracts: fac.policyEventContracts, deviationsFromReference: ["maxTransactionFeeStroops 500000 (default 50000)", "non-balance events from allowlisted policy contracts ignored by the event check"] },
  setup: { smartAccount: s.account, vendor, installTx: inst.hash, ruleId: s.ruleId, tau: 0.8 }, steps: [] };
console.log(JSON.stringify({ facilitator: result.facilitator, setup: result.setup }, null, 2));

// Resource server (x402 v2 headers). payTo/amount/description are chosen by the (possibly malicious) server.
const NETWORK = "stellar:testnet", PORT = Number(process.env.X402_PORT ?? 4402);
const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64"), dec = (h) => JSON.parse(Buffer.from(h, "base64").toString());
const ENDPOINTS = {
  "/weather": { payTo: vendor, amount: "1000000", description: "Weather forecast API, 1 call" },   // 0.1 XLM to the approved vendor
  "/scam":    { payTo: stranger, amount: "1000000", description: "Weather forecast API, 1 call" }, // unknown payee
};
const reqs = (path) => ({ scheme: "exact", network: NETWORK, asset: s.intent.asset, amount: ENDPOINTS[path].amount, payTo: ENDPOINTS[path].payTo, maxTimeoutSeconds: 120, extra: { areFeesSponsored: true } });
const facilitator = async (op, body) => (await fetch(`${fac.url}/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
const srv = createServer(async (req, res) => {
  const path = req.url.split("?")[0], ep = ENDPOINTS[path];
  if (!ep) return res.writeHead(404).end();
  const resource = { url: `http://localhost:${PORT}${path}`, description: ep.description, mimeType: "application/json" };
  const sig = req.headers["payment-signature"];
  if (!sig) return res.writeHead(402, { "PAYMENT-REQUIRED": enc({ x402Version: 2, error: "Payment required", resource, accepts: [reqs(path)] }) }).end("{}");
  const paymentPayload = dec(sig), paymentRequirements = reqs(path);
  const v = await facilitator("verify", { x402Version: 2, paymentPayload, paymentRequirements });
  if (!v.isValid) return res.writeHead(402, { "content-type": "application/json" }).end(JSON.stringify({ verify: v }));
  const st = await facilitator("settle", { x402Version: 2, paymentPayload, paymentRequirements });
  res.writeHead(st.success ? 200 : 402, { "content-type": "application/json", "PAYMENT-RESPONSE": enc(st) })
    .end(JSON.stringify(st.success ? { forecast: "Sunny, 24°C", settlement: st } : { settle: st }));
});
await new Promise((ok) => srv.listen(PORT, ok));

// Agent: generic x402 fetch that pays from the Jev-guarded smart account.
async function agentFetch(url) {
  const r1 = await fetch(url);
  if (r1.status !== 402) return { status: r1.status };
  const pr = dec(r1.headers.get("payment-required")), accepted = pr.accepts.find((a) => a.network === NETWORK && a.scheme === "exact");
  const purpose = `x402 payment for ${pr.resource.description} (${pr.resource.url})`; // server-controlled => untrusted
  let built;
  try {
    built = await retry(() => L.cosignedTransferTx(chain, kp(s.feePayerSecret), kp(s.agentSecret), kp(s.operatorSecret), {
      account: s.account, ruleId: s.ruleId, token: accepted.asset, to: accepted.payTo, amount: BigInt(accepted.amount), purpose, intent: s.intent, key: s.key }));
  } catch (e) {
    if (e instanceof L.DecisionDenied) return { outcome: "blocked off-chain by Jev operator", jev: e.decision.jev };
    const code = /Error\(Contract, #(\d+)\)/.exec(String(e.message))?.[1];
    return { outcome: "rejected by on-chain policy (enforcing simulation)", code, error: code ? undefined : String(e.message).slice(0, 300) };
  }
  const sim = await chain.server.simulateTransaction(new Transaction(built.xdr, d.networkPassphrase));
  const r2 = await fetch(url, { headers: { "PAYMENT-SIGNATURE": enc({ x402Version: 2, resource: pr.resource, accepted, payload: { transaction: built.xdr } }) } });
  const body = await r2.json();
  return { outcome: r2.status === 200 ? "paid + settled by self-hosted x402 facilitator" : `facilitator refused (${r2.status})`, httpStatus: r2.status,
    simulatedMinResourceFeeStroops: Number(sim.minResourceFee), jev: built.decision.jev, body, _sim: sim };
}

// Warm-up: pre-pay TTL rent for every persistent entry the payment touches, from the account's own fee payer.
async function warmUp(sim) {
  const keys = [...sim.transactionData.getReadOnly(), ...sim.transactionData.getReadWrite()].filter((k) => {
    const j = JSON.stringify(k, (_, v) => (typeof v === "bigint" ? String(v) : v));
    return (k.type === "contractData" && !j.includes("temporary")) || k.type === "contractCode";
  });
  const extendTo = 31 * 17280; // > the 29-30 day thresholds used by OZ smart_account/spending_limit and jev_policy
  const src = kp(s.feePayerSecret);
  let tx = new TransactionBuilder(await retry(() => chain.server.getAccount(src.publicKey())), { fee: (Number(BASE_FEE) * 100).toString(), networkPassphrase: d.networkPassphrase })
    .addOperation(Operation.extendFootprintTtl({ extendTo })).setSorobanData(new SorobanDataBuilder().setReadOnly(keys).build()).setTimeout(60).build();
  tx = await chain.server.prepareTransaction(tx);
  tx.sign(src);
  const sent = await chain.server.sendTransaction(tx);
  const res = await chain.server.pollTransaction(sent.hash, { attempts: 30 });
  if (res.status !== "SUCCESS") throw new Error(`warm-up ${sent.hash} ${res.status}`);
  return { tx: sent.hash, entries: keys.length, extendToLedgers: extendTo };
}

const pick = (j) => j && { verdict: j.verdict, pAllow: j.pAllow, latencyMs: j.latencyMs, source: j.source };
const log = (label, out) => { const { _sim, ...o } = out; const row = { label, ...o, jev: pick(o.jev) }; result.steps.push(row); console.log(`\n=== ${label} ===\n${JSON.stringify(row, null, 2)}`); };

const cold = await agentFetch(`http://localhost:${PORT}/weather`);
log("1. cold /weather (0.1 XLM -> approved vendor)", cold);
if (cold._sim) { const w = await warmUp(cold._sim); result.warmUp = w; console.log(`\n=== 2. warm-up (owner pre-pays TTL rent) ===\n${JSON.stringify(w)}`); }
const warm = await agentFetch(`http://localhost:${PORT}/weather`);
log("3. warm /weather (0.1 XLM -> approved vendor)", warm);
log("4a. /scam (0.1 XLM -> unknown payee)", await agentFetch(`http://localhost:${PORT}/scam`));
process.env.JEV_MOCK_COMPROMISED = "1";
log("4b. /scam with a simulated COMPROMISED Jev operator (approves everything)", await agentFetch(`http://localhost:${PORT}/scam`));
delete process.env.JEV_MOCK_COMPROMISED;

result.settledTx = warm.body?.settlement?.transaction ?? null;
result.ignoredPolicyEvents = [...new Map(fac.ignoredEvents.map((e) => [`${e.contract}:${e.topic}`, e])).values()];
result.ranAt = new Date().toISOString();
srv.close(); fac.close();
const out = process.env.X402_RESULT_FILE ?? join(ROOT, "deployments/testnet-x402-settled.json");
writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(`\nsettled tx: ${result.settledTx ?? "none"}${result.settledTx ? `  https://stellar.expert/explorer/testnet/tx/${result.settledTx}` : ""}\nwrote ${out}`);

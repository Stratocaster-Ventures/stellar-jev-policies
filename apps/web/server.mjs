// POC backend for the config UI. Reuses the shared TS library (@stellar-jev-policies/sdk):
// deploys the passkey-owned OZ smart account, relays the owner's passkey assertion for
// add_context_rule, runs the Jev operator, and streams the decision log.
// Keys are POC-local (.jev/web-state.json, gitignored). JEV_API_KEY is read from env only.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import * as L from "@stellar-jev-policies/sdk";

const here = dirname(fileURLToPath(import.meta.url));
const STATE = process.env.JEV_WEB_STATE ?? join(here, "../../.jev/web-state.json");
const PORT = Number(process.env.PORT ?? 4317);
const d = L.loadDeployments(), chain = new L.Chain(d);
const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {});
const save = (s) => { mkdirSync(dirname(STATE), { recursive: true }); writeFileSync(STATE, JSON.stringify(s, null, 2), { mode: 0o600 }); };
const kp = (s) => Keypair.fromSecret(s);
const b = (x) => Buffer.from(x, "base64url");
const log = []; // decision log (in memory)
const pending = new Map(); // challenge id -> resolve(assertion)
let job = null; // { id, challenge, done, result, error }

async function keys() {
  const s = load();
  if (!s.feePayerSecret) {
    Object.assign(s, { feePayerSecret: Keypair.random().secret(), agentSecret: Keypair.random().secret(), operatorSecret: Keypair.random().secret() });
    await L.friendbot(kp(s.feePayerSecret).publicKey()); save(s);
  }
  return s;
}
const credOf = (s) => ({ publicKey: b(s.passkey.publicKey), credentialId: b(s.passkey.credentialId) });

const routes = {
  "GET /api/config": async () => { const s = load(); return { network: d.network, contracts: d.contracts, webauthnVerifier: d.webauthn_verifier, token: d.assets.native_xlm_sac, account: s.account, ruleId: s.ruleId, intent: s.intent, key: s.key, passkey: s.passkey ? { credentialId: s.passkey.credentialId } : null, jevMode: process.env.JEV_API_KEY ? "jev" : "mock", framing: L.DEFAULT_FRAMING, model: L.DEFAULT_MODEL }; },
  "POST /api/account": async (q) => {
    const s = await keys();
    s.passkey = { publicKey: q.publicKey, credentialId: q.credentialId };
    const r = await L.createAccount(chain, kp(s.feePayerSecret), L.passkeySigner(d.webauthn_verifier, credOf(s)), Number(q.fund ?? 50));
    Object.assign(s, { account: r.account, ruleId: undefined, intent: undefined, key: undefined }); save(s);
    return r;
  },
  // Starts add_context_rule; the owner rule needs the passkey, so we park until /api/assert delivers it.
  "POST /api/install": async (q) => {
    const s = await keys();
    if (!s.account) throw new Error("create the passkey account first");
    const toS = (x) => BigInt(Math.round(Number(x) * 1e7));
    const maxPerCall = toS(q.maxPerCall), recipients = q.recipients.filter(Boolean);
    const intent = { description: q.intent, asset: d.assets.native_xlm_sac, recipients, max_amount: maxPerCall.toString() };
    const key = { tauAllowPpm: Math.round(Number(q.tau) * 1e6), templateId: 1, maxAgeLedgers: 12, model: L.DEFAULT_MODEL };
    const allow = (q.allow?.length ? q.allow : [`${d.assets.native_xlm_sac}:transfer`]).map((x) => { const [contract, fn] = x.split(":"); return { contract, fn }; });
    const id = Math.random().toString(36).slice(2);
    job = { id, challenge: null, done: false };
    const ownerAuth = L.passkeyOwnerAuth(s.account, d.webauthn_verifier, credOf(s), [L.OWNER_RULE], (challenge) =>
      new Promise((resolve, reject) => { job.challenge = challenge.toString("base64url"); pending.set(id, { resolve, reject }); setTimeout(() => reject(new Error("passkey timeout")), 120000); }));
    L.installSession(chain, kp(s.feePayerSecret), ownerAuth, kp(s.agentSecret), kp(s.operatorSecret), {
      account: s.account, token: d.assets.native_xlm_sac, limit: toS(q.limit), periodLedgers: Number(q.periodLedgers ?? 17280), allow, recipients, maxPerCall, intent, key,
    }).then((r) => { Object.assign(s, { ruleId: r.ruleId, intent, key }); save(s); job.result = { hash: r.hash, ruleId: r.ruleId, intentHash: L.intentHash(intent).toString("hex") }; job.done = true; })
      .catch((e) => { job.error = String(e.message).slice(0, 500); job.done = true; });
    return { id };
  },
  "GET /api/install": async () => job ?? {},
  "POST /api/assert": async (q) => {
    const p = pending.get(q.id); if (!p) throw new Error("no pending passkey request");
    pending.delete(q.id); p.resolve({ authenticatorData: b(q.authenticatorData), clientDataJSON: b(q.clientDataJSON), signature: b(q.signature) });
    return { ok: true };
  },
  // Simulated agent payment, co-signed by the Jev operator.
  "POST /api/agent/pay": async (q) => {
    const s = load(); if (s.ruleId === undefined) throw new Error("install the session first");
    const entry = { ts: new Date().toISOString(), to: q.to, amount: q.amount, purpose: q.purpose };
    try {
      const r = await L.cosignedTransfer(chain, kp(s.feePayerSecret), kp(s.agentSecret), kp(s.operatorSecret), {
        account: s.account, ruleId: s.ruleId, token: s.intent.asset, to: q.to, amount: BigInt(Math.round(Number(q.amount) * 1e7)), purpose: q.purpose ?? "", intent: s.intent, key: s.key });
      Object.assign(entry, { outcome: "settled", hash: r.hash, jev: pick(r.decision.jev) });
    } catch (e) {
      if (e instanceof L.DecisionDenied) Object.assign(entry, { outcome: "blocked off-chain", jev: pick(e.decision.jev) });
      else { const code = /Error\(Contract, #(\d+)\)/.exec(String(e.message))?.[1]; Object.assign(entry, { outcome: "rejected on-chain", code: code ? Number(code) : undefined, error: code ? undefined : String(e.message).slice(0, 200) }); }
    }
    log.unshift(entry); return entry;
  },
  "GET /api/log": async () => log,
  "POST /api/fund-recipient": async (q) => { await L.friendbot(q.address); return { ok: true }; },
  "GET /api/new-address": async () => { const k = Keypair.random(); await L.friendbot(k.publicKey()); return { address: k.publicKey() }; },
};
const pick = (j) => ({ verdict: j.verdict, pAllow: j.pAllow, latencyMs: j.latencyMs, source: j.source, model: j.model, framing: j.framing });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
createServer(async (req, res) => {
  const path = req.url.split("?")[0], h = routes[`${req.method} ${path}`];
  if (h) {
    let body = ""; for await (const c of req) body += c;
    try { const out = await h(body ? JSON.parse(body) : {}); res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v))); }
    catch (e) { res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: String(e.message ?? e) })); }
    return;
  }
  const f = join(here, "dist", path === "/" ? "index.html" : path);
  if (existsSync(f) && !f.includes("..")) { res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" }).end(readFileSync(f)); return; }
  res.writeHead(404).end();
}).listen(PORT, () => console.log(`Stellar JEV Policies UI on http://localhost:${PORT} (${process.env.JEV_API_KEY ? "Jev" : "MOCK"} mode)`));

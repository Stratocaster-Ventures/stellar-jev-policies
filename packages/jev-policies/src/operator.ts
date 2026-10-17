// Jev operator: recomputes the auth digest from the raw auth entry (never trusts the agent's
// summary), asks Jev, and co-signs only the exact digest. POC: in-process or HTTP.
import { createServer } from "node:http";
import { Keypair, xdr, scValToNative, Address } from "@stellar/stellar-sdk";
import { authDigest, decisionMessage, encodeDecision, intentHash, modelIdHash, sorobanAuthPayload, VERDICT, PPM } from "./encoding.js";
import { decide, Intent, TxSummary, JevResult } from "./jev.js";

export interface DecisionRequest {
  networkPassphrase: string; account: string; ruleId: number;
  entryXdr: string; expiration: number; currentLedger: number;
  intent: Intent; claimedPurpose: string; model: string; templateId: number; maxAgeLedgers: number;
}
export interface DecisionResponse { decisionXdr: string; jev: JevResult; verdict: number; pAllowPpm: number; authDigest: string; tx: TxSummary }

export function summarize(entry: xdr.SorobanAuthorizationEntry): TxSummary {
  const fn: any = entry.rootInvocation.function;
  if (fn.type !== "sorobanAuthorizedFunctionTypeContractFn") return { contract: "", fn: "create_contract" };
  const c = fn.contractFn;
  const args = (c.args as xdr.ScVal[]).map((a) => scValToNative(a));
  const out: TxSummary = { contract: Address.fromScAddress(c.contractAddress).toString(), fn: String(c.functionName.value ?? c.functionName) };
  if (out.fn === "transfer" || out.fn === "approve") { out.from = String(args[0]); out.to = String(args[1]); out.amount = String(args[2]); }
  return out;
}

export async function handleDecision(op: Keypair, req: DecisionRequest): Promise<DecisionResponse> {
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(req.entryXdr, "base64");
  const payload = sorobanAuthPayload(entry, req.networkPassphrase, req.expiration);
  const digest = authDigest(req.account, payload, [req.ruleId]);
  const tx = summarize(entry);
  const jev = await decide(req.intent, tx, req.claimedPurpose, req.model);
  const verdict = jev.verdict === "allow" ? VERDICT.ALLOW : jev.verdict === "escalate" ? VERDICT.ESCALATE : VERDICT.DENY;
  const fields = {
    verdict, pAllowPpm: Math.round(Math.min(1, Math.max(0, jev.pAllow)) * PPM),
    modelId: modelIdHash(req.model), intentHash: intentHash(req.intent), templateId: req.templateId,
    issuedLedger: req.currentLedger, expiryLedger: Math.min(req.currentLedger + req.maxAgeLedgers, req.expiration + 1),
  };
  const sig = signB(op, decisionMessage(digest, fields));
  return { decisionXdr: encodeDecision(fields, [{ idx: 0, sig }]).toString("base64"), jev, verdict, pAllowPpm: fields.pAllowPpm, authDigest: digest.toString("hex"), tx };
}

export function serve(op: Keypair, port: number) {
  const srv = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/decide") { res.writeHead(404).end(); return; }
    let body = "";
    for await (const c of req) body += c;
    try {
      const out = await handleDecision(op, JSON.parse(body));
      console.log(JSON.stringify({ ts: new Date().toISOString(), verdict: out.jev.verdict, p_allow: out.jev.pAllow, source: out.jev.source, latency_ms: out.jev.latencyMs, tx: out.tx, digest: out.authDigest }));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
    } catch (e: any) { res.writeHead(400).end(JSON.stringify({ error: e.message })); }
  });
  srv.listen(port, () => console.log(`jev operator ${op.publicKey()} listening on :${port} (${process.env.JEV_API_KEY ? "Jev" : "MOCK"} mode)`));
  return srv;
}

function signB(k: Keypair, m: Uint8Array): Buffer { return Buffer.from(k.sign(Buffer.from(m))); }

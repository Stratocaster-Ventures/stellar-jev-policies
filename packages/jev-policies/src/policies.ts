// High-level flows: create account, install a Jev session rule, co-signed agent transfers.
import { Keypair, Operation, xdr } from "@stellar/stellar-sdk";
import { Chain, AuthSigner } from "./chain.js";
import type { Deployments } from "./config.js";
import { authDigest, authPayload, encodeJevKey, intentHash, modelIdHash, signerExternal } from "./encoding.js";
import { addr, enumVariant, i128, map, none, str, struct, sym, u32, vec } from "./scval.js";
import type { Intent } from "./jev.js";
import { handleDecision, DecisionRequest, DecisionResponse } from "./operator.js";

export const OWNER_RULE = 0;

export function ownerSigner(d: Deployments, owner: Keypair) { return signerExternal(d.contracts.oz_ed25519_verifier, Buffer.from(owner.rawPublicKey())); }
export function agentSigner(d: Deployments, agent: Keypair) { return signerExternal(d.contracts.oz_ed25519_verifier, Buffer.from(agent.rawPublicKey())); }
export interface KeyParams { tauAllowPpm: number; templateId: number; maxAgeLedgers: number; model: string }
export function jevSigner(d: Deployments, operator: Keypair, intent: Intent, kp: KeyParams) {
  const key = encodeJevKey({ operators: [Buffer.from(operator.rawPublicKey())], k: 1, modelId: modelIdHash(kp.model), intentHash: intentHash(intent), ...kp });
  return signerExternal(d.contracts.jev_verifier, key);
}

/** Owner-signed AuthPayload for the Default rule (POC: ed25519 stands in for the passkey). */
export const ownerAuth = (account: string, owner: Keypair, d: Deployments) =>
  async (_e: xdr.SorobanAuthorizationEntry, payload: Buffer) =>
    authPayload([[ownerSigner(d, owner), signB(owner, authDigest(account, payload, [OWNER_RULE]))]], [OWNER_RULE]);

export async function createAccount(chain: Chain, feePayer: Keypair, owner: Keypair | xdr.ScVal, fundXlm: number) {
  const d = chain.d;
  const ownerS = owner instanceof Keypair ? ownerSigner(d, owner) : owner;
  const { contractId, hash } = await chain.deployContract(feePayer, d.wasmHashes.oz_smart_account, [vec([ownerS]), map([])]);
  const fund = await chain.invoke(feePayer, Operation.invokeContractFunction({
    contract: d.assets.native_xlm_sac, function: "transfer",
    args: [addr(feePayer.publicKey()), addr(contractId), i128(BigInt(Math.round(fundXlm * 1e7)))],
  }));
  return { account: contractId, deployTx: hash, fundTx: fund.hash };
}

export interface InstallOpts {
  account: string; token: string; limit: bigint; periodLedgers: number;
  allow: { contract: string; fn: string }[]; recipients: string[]; maxPerCall: bigint;
  intent: Intent; key: KeyParams;
}

export function sessionPolicies(d: Deployments, jev: xdr.ScVal, o: InstallOpts) {
  const jevParams = struct({
    jev_signer: jev, spending_limit: addr(d.contracts.oz_spending_limit),
    allowlist: vec(o.allow.map((a) => struct({ contract: addr(a.contract), fn_name: sym(a.fn) }))),
    token_rules: vec([struct({ token: addr(o.token), max_amount: i128(o.maxPerCall), recipients: vec(o.recipients.map(addr)) })]),
  });
  return map([
    [addr(d.contracts.oz_simple_threshold), struct({ threshold: u32(2) })],
    [addr(d.contracts.oz_spending_limit), struct({ spending_limit: i128(o.limit), period_ledgers: u32(o.periodLedgers) })],
    [addr(d.contracts.jev_policy), jevParams],
  ]);
}

/** add_context_rule(CallContract(token), "jev-agent-session", None, [agent, jev], {threshold 2, spending_limit, jev_policy}). */
export async function installSession(chain: Chain, feePayer: Keypair, owner: Keypair | AuthSigner, agent: Keypair, operator: Keypair, o: InstallOpts) {
  const d = chain.d;
  const jev = jevSigner(d, operator, o.intent, o.key);
  const op = Operation.invokeContractFunction({
    contract: o.account, function: "add_context_rule",
    args: [enumVariant("CallContract", addr(o.token)), str("jev-agent-session"), none(), vec([agentSigner(d, agent), jev]), sessionPolicies(d, jev, o)],
  });
  const r = await chain.invoke(feePayer, op, o.account, owner instanceof Keypair ? ownerAuth(o.account, owner, d) : owner);
  return { hash: r.hash, ruleId: Number((r.ret as any).id), rule: r.ret };
}

export interface TransferOpts {
  account: string; ruleId: number; token: string; to: string; amount: bigint; purpose: string;
  intent: Intent; key: KeyParams; operatorUrl?: string; force?: boolean;
}

async function requestDecision(operator: Keypair | undefined, url: string | undefined, req: DecisionRequest): Promise<DecisionResponse> {
  if (url) {
    const r = await fetch(`${url.replace(/\/$/, "")}/v1/decide`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
    if (!r.ok) throw new Error(`operator ${r.status}: ${await r.text()}`);
    return (await r.json()) as DecisionResponse;
  }
  if (!operator) throw new Error("no operator key or JEV_OPERATOR_URL");
  return handleDecision(operator, req);
}

export class DecisionDenied extends Error { constructor(public decision: DecisionResponse) { super(`Jev ${decision.jev.verdict} (p_allow=${decision.jev.pAllow})`); } }

/** Agent-initiated SEP-41 transfer from the smart account, co-signed by the Jev operator. */
export async function cosignedTransfer(chain: Chain, feePayer: Keypair, agent: Keypair, operator: Keypair | undefined, o: TransferOpts) {
  const d = chain.d;
  let decision: DecisionResponse | undefined;
  const op = Operation.invokeContractFunction({ contract: o.token, function: "transfer", args: [addr(o.account), addr(o.to), i128(o.amount)] });
  const signer = async (entry: xdr.SorobanAuthorizationEntry, payload: Buffer, expiration: number) => {
    decision = await requestDecision(operator, o.operatorUrl, {
      networkPassphrase: d.networkPassphrase, account: o.account, ruleId: o.ruleId, entryXdr: entry.toXDR("base64"),
      expiration, currentLedger: await chain.latestLedger(), intent: o.intent, claimedPurpose: o.purpose,
      model: o.key.model, templateId: o.key.templateId, maxAgeLedgers: o.key.maxAgeLedgers,
    });
    // Gate off-chain on the same rule jev_verifier enforces: verdict ALLOW and p_allow >= tau.
    if ((decision.verdict !== 1 || decision.pAllowPpm < o.key.tauAllowPpm) && !o.force) throw new DecisionDenied(decision);
    const digest = authDigest(o.account, payload, [o.ruleId]);
    if (digest.toString("hex") !== decision.authDigest) throw new Error("operator signed a different digest");
    if (!operator) throw new Error("jev signer key data needs the operator public key");
    return authPayload([
      [agentSigner(d, agent), signB(agent, digest)],
      [jevSigner(d, operator, o.intent, o.key), Buffer.from(decision.decisionXdr, "base64")],
    ], [o.ruleId]);
  };
  const r = await chain.invoke(feePayer, op, o.account, signer);
  return { ...r, decision: decision! };
}

/** Same co-signed flow, but returns the assembled (unsubmitted) tx XDR, e.g. as an x402 `exact` payload. */
export async function cosignedTransferTx(chain: Chain, source: Keypair, agent: Keypair, operator: Keypair | undefined, o: TransferOpts) {
  let decision: DecisionResponse | undefined;
  const tx = await chain.prepare(source, Operation.invokeContractFunction({ contract: o.token, function: "transfer", args: [addr(o.account), addr(o.to), i128(o.amount)] }), o.account,
    async (entry, payload, expiration) => {
      decision = await requestDecision(operator, o.operatorUrl, {
        networkPassphrase: chain.d.networkPassphrase, account: o.account, ruleId: o.ruleId, entryXdr: entry.toXDR("base64"),
        expiration, currentLedger: await chain.latestLedger(), intent: o.intent, claimedPurpose: o.purpose,
        model: o.key.model, templateId: o.key.templateId, maxAgeLedgers: o.key.maxAgeLedgers,
      });
      if ((decision.verdict !== 1 || decision.pAllowPpm < o.key.tauAllowPpm) && !o.force) throw new DecisionDenied(decision);
      const digest = authDigest(o.account, payload, [o.ruleId]);
      if (digest.toString("hex") !== decision.authDigest) throw new Error("operator signed a different digest");
      if (!operator) throw new Error("jev signer key data needs the operator public key");
      return authPayload([[agentSigner(chain.d, agent), signB(agent, digest)], [jevSigner(chain.d, operator, o.intent, o.key), Buffer.from(decision.decisionXdr, "base64")]], [o.ruleId]);
    });
  return { xdr: tx.toXDR(), decision: decision! };
}

function signB(k: Keypair, m: Uint8Array): Buffer { return Buffer.from(k.sign(Buffer.from(m))); }

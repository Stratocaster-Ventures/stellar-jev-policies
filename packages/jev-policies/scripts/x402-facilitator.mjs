// Self-hosted x402 facilitator for Stellar (scheme "exact"), built on the x402 Foundation reference
// implementation (@x402/stellar ExactStellarScheme, pinned 2.28.0). Same verify/settle rules as the
// hosted facilitators (single SEP-41 transfer, payer-signed auth, no sub-invocations, simulation must
// emit exactly the expected transfer, facilitator never in auth), with one operator knob raised:
//   maxTransactionFeeStroops (spec default 50,000). A payment from an OZ smart account runs
//   __check_auth -> signature verifiers -> context-rule policies (jev_policy, spending_limit), so its
//   simulation-derived resource fee is ~310k stroops warm, ~5.7M cold (first-touch TTL rent).
//   We default the ceiling to 500,000 stroops (0.05 XLM): warm smart-account payments pass, cold ones
//   are still refused by the circuit breaker.
// Second deviation (policy-aware event check): the reference validateSimulationEvents rejects ANY
//   contract event that is not a `transfer` (invalid_exact_stellar_payload_event_not_transfer). OZ's own
//   spending_limit / simple_threshold policies emit `spending_limit_enforced` / `simple_enforced` and
//   jev_policy emits `jev_policy_enforced`
//   during __check_auth, so every OZ smart account with a spending limit is refused. The spec only
//   requires "NO OTHER BALANCE CHANGES". We drop an event before the reference check ONLY if it comes
//   from an explicitly allowlisted policy contract (X402_POLICY_EVENT_CONTRACTS) AND its first topic is
//   not a balance-moving symbol (transfer/mint/burn/clawback/approve/set_authorized). Everything else
//   (exactly one transfer of the exact amount from payer to payTo on the asset) is checked unchanged.
// Usage: node scripts/x402-facilitator.mjs   (env: X402_FACILITATOR_SECRET, X402_MAX_FEE_STROOPS, X402_FACILITATOR_PORT,
//        X402_POLICY_EVENT_CONTRACTS=C...,C...)
// Or import { startFacilitator } and run it in-process (see x402-settle-demo.mjs).
import { createServer } from "node:http";
import { Keypair } from "@stellar/stellar-sdk";
import { createRequire } from "node:module";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/facilitator";

export const DEFAULT_MAX_FEE_STROOPS = 500_000;
const BALANCE_SYMBOLS = new Set(["transfer", "mint", "burn", "clawback", "approve", "set_authorized"]);

class PolicyAwareExactStellarScheme extends ExactStellarScheme {
  constructor(signers, opts, policyEventContracts) { super(signers, opts); this.policyEventContracts = new Set(policyEventContracts); this.ignoredEvents = []; }
  validateSimulationEvents(events, fromAddress, toAddress, expectedAmount, expectedAsset) {
    const kept = [];
    for (const de of events) {
      try {
        const ev = de.event();
        if (ev.type().name === "contract" && ev.contractId()) {
          const contract = Address.fromScAddress(xdr.ScAddress.scAddressTypeContract(ev.contractId())).toString();
          const t0 = ev.body().v0().topics()[0];
          const sym = t0 && t0.switch().name === "scvSymbol" ? t0.sym().toString() : null;
          if (contract !== expectedAsset && this.policyEventContracts.has(contract) && sym && !BALANCE_SYMBOLS.has(sym)) { this.ignoredEvents.push({ contract, topic: sym }); continue; }
        }
      } catch { /* unparseable: keep it, the reference check decides */ }
      kept.push(de);
    }
    if (process.env.X402_DEBUG_EVENTS) console.error("kept events:", kept.map((de) => { try { const ev = de.event(); const t = ev.body().v0().topics(); return { type: ev.type().name, contract: ev.contractId() ? Address.fromScAddress(xdr.ScAddress.scAddressTypeContract(ev.contractId())).toString() : null, topics: t.map((x) => x.switch().name === "scvSymbol" ? x.sym().toString() : x.switch().name) }; } catch (e) { return String(e); } }));
    return super.validateSimulationEvents(kept, fromAddress, toAddress, expectedAmount, expectedAsset);
  }
}
const NETWORK = "stellar:testnet";
// Decode events with the same stellar-sdk instance @x402/stellar uses (its XDR classes differ from sdk 17).
const x402Require = createRequire(createRequire(import.meta.url).resolve("@x402/stellar"));
const { Address, xdr } = x402Require("@stellar/stellar-sdk");

export async function startFacilitator({ secret, port = 4022, maxTransactionFeeStroops = DEFAULT_MAX_FEE_STROOPS, rpcUrl, policyEventContracts = [] } = {}) {
  let kp = secret ? Keypair.fromSecret(secret) : Keypair.random();
  if (!secret) { const r = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`); if (!r.ok) throw new Error(`friendbot ${r.status}`); }
  const scheme = new PolicyAwareExactStellarScheme([createEd25519Signer(kp.secret(), NETWORK)], {
    maxTransactionFeeStroops, ...(rpcUrl ? { rpcConfig: { url: rpcUrl } } : {}),
  }, policyEventContracts);
  const read = (req) => new Promise((ok, ko) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch (e) { ko(e); } }); });
  const srv = createServer(async (req, res) => {
    const send = (code, o) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(o));
    try {
      if (req.method === "GET" && req.url === "/supported")
        return send(200, { kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK, extra: scheme.getExtra(NETWORK) }], signers: { [NETWORK]: scheme.getSigners(NETWORK) }, maxTransactionFeeStroops, policyEventContracts });
      if (req.method !== "POST" || !["/verify", "/settle"].includes(req.url)) return send(404, { error: "not found" });
      const { paymentPayload, paymentRequirements } = await read(req);
      const out = req.url === "/verify" ? await scheme.verify(paymentPayload, paymentRequirements) : await scheme.settle(paymentPayload, paymentRequirements);
      return send(200, out);
    } catch (e) { return send(500, { error: String(e?.message ?? e) }); }
  });
  await new Promise((ok) => srv.listen(port, ok));
  return { url: `http://localhost:${port}`, address: kp.publicKey(), maxTransactionFeeStroops, policyEventContracts, ignoredEvents: scheme.ignoredEvents, close: () => srv.close() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = await startFacilitator({
    secret: process.env.X402_FACILITATOR_SECRET, port: Number(process.env.X402_FACILITATOR_PORT ?? 4022),
    maxTransactionFeeStroops: Number(process.env.X402_MAX_FEE_STROOPS ?? DEFAULT_MAX_FEE_STROOPS),
    policyEventContracts: (process.env.X402_POLICY_EVENT_CONTRACTS ?? "").split(",").filter(Boolean),
  });
  console.log(JSON.stringify({ facilitator: f.url, signer: f.address, network: NETWORK, maxTransactionFeeStroops: f.maxTransactionFeeStroops }));
}

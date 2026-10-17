// Node e2e: software P-256 "authenticator" -> OZ webauthn verifier owner -> install Jev session on testnet.
import { generateKeyPairSync, createSign, createHash, randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
const L = await import("../dist/index.js");
const d = L.loadDeployments(), chain = new L.Chain(d);
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = publicKey.export({ format: "jwk" });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
const cred = { publicKey: pub, credentialId: randomBytes(16) };
const origin = "http://localhost:5173", rpId = "localhost";
const assert = async (challenge) => {
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: challenge.toString("base64url"), origin, crossOrigin: false }));
  const authenticatorData = Buffer.concat([createHash("sha256").update(rpId).digest(), Buffer.from([0x05]), Buffer.from([0, 0, 0, 1])]);
  const signature = createSign("sha256").update(Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()])).sign(privateKey);
  return { authenticatorData, clientDataJSON, signature };
};
const fp = Keypair.random(), agent = Keypair.random(), op = Keypair.random(); await L.friendbot(fp.publicKey());
const acc = await L.createAccount(chain, fp, L.passkeySigner(d.webauthn_verifier, cred), 20);
console.log("account", acc);
const merchant = Keypair.random().publicKey();
const intent = { description: "Pay the approved vendor for small invoices", asset: d.assets.native_xlm_sac, recipients: [merchant], max_amount: "50000000" };
const key = { tauAllowPpm: 800000, templateId: 1, maxAgeLedgers: 12, model: "jev-1.13.0" };
const r = await L.installSession(chain, fp, L.passkeyOwnerAuth(acc.account, d.webauthn_verifier, cred, [0], assert), agent, op, {
  account: acc.account, token: d.assets.native_xlm_sac, limit: 100000000n, periodLedgers: 17280, allow: [{ contract: d.assets.native_xlm_sac, fn: "transfer" }],
  recipients: [merchant], maxPerCall: 50000000n, intent, key });
console.log("install(passkey-signed)", r.hash, "rule", r.ruleId);
await fetch(`https://friendbot.stellar.org/?addr=${merchant}`);
const t = await L.cosignedTransfer(chain, fp, agent, op, { account: acc.account, ruleId: r.ruleId, token: d.assets.native_xlm_sac, to: merchant, amount: 20000000n, purpose: "Invoice #2001 from approved vendor", intent, key });
console.log("transfer", t.hash, t.decision.jev.verdict, t.decision.jev.pAllow, t.decision.jev.latencyMs);

// Byte-exact client encodings for jev_verifier / OZ stellar-accounts types.
import { createHash } from "node:crypto";
import { Address, hash, xdr, buildAuthorizationEntryPreimage } from "@stellar/stellar-sdk";
import { addr, bytes, enumVariant, struct, u32, vec, map } from "./scval.js";

export const sha256 = (b: Uint8Array | string): Buffer => createHash("sha256").update(b).digest();

export const VERDICT = { DENY: 0, ALLOW: 1, ESCALATE: 2 } as const;
export const PPM = 1_000_000;

export interface JevKey {
  operators: Buffer[]; // ed25519 pubkeys (32 B each), max 4
  k: number;
  modelId: Buffer; // sha256(model string)
  intentHash: Buffer;
  tauAllowPpm: number;
  templateId: number;
  maxAgeLedgers: number;
}

/** Compact key, identical to `jev_verifier::encode_key` (OZ caps External key_data at 256 B). */
export function encodeJevKey(k: JevKey): Buffer {
  if (k.operators.length > 4 || k.k < 1 || k.k > k.operators.length) throw new Error("bad operator set");
  const h = Buffer.alloc(15);
  h[0] = 1; h[1] = k.k; h[2] = k.operators.length;
  h.writeUInt32BE(k.tauAllowPpm, 3); h.writeUInt32BE(k.templateId, 7); h.writeUInt32BE(k.maxAgeLedgers, 11);
  return Buffer.concat([h, k.modelId, k.intentHash, ...k.operators]);
}

export const modelIdHash = (model: string) => sha256(model);

/** Canonical JSON (sorted keys, no whitespace) so intent_hash is reproducible. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const intentHash = (intent: unknown) => sha256(canonicalJson(intent));

export const signerExternal = (verifier: string, keyData: Buffer) => enumVariant("External", addr(verifier), bytes(keyData));
export const signerDelegated = (a: string) => enumVariant("Delegated", addr(a));

export interface DecisionFields {
  verdict: number; pAllowPpm: number; modelId: Buffer; intentHash: Buffer;
  templateId: number; issuedLedger: number; expiryLedger: number;
}

/** sha256(xdr(DecisionBody)) — what operators sign. Mirrors jev_verifier::decision_message. */
export function decisionMessage(authDigest: Buffer, d: DecisionFields): Buffer {
  const body = struct({
    auth_digest: bytes(authDigest), verdict: u32(d.verdict), p_allow_ppm: u32(d.pAllowPpm),
    model_id: bytes(d.modelId), intent_hash: bytes(d.intentHash), template_id: u32(d.templateId),
    issued_ledger: u32(d.issuedLedger), expiry_ledger: u32(d.expiryLedger),
  });
  return sha256(body.toXDR());
}

/** XDR(JevDecision) — the signature bytes for the Jev External signer. */
export function encodeDecision(d: DecisionFields, sigs: { idx: number; sig: Buffer }[]): Buffer {
  return Buffer.from(struct({
    verdict: u32(d.verdict), p_allow_ppm: u32(d.pAllowPpm), model_id: bytes(d.modelId),
    intent_hash: bytes(d.intentHash), template_id: u32(d.templateId),
    issued_ledger: u32(d.issuedLedger), expiry_ledger: u32(d.expiryLedger),
    sigs: vec(sigs.map((s) => struct({ idx: u32(s.idx), sig: bytes(s.sig) }))),
  }).toXDR());
}

/** OZ AuthDigestPreimage digest: sha256(xdr({account, signature_payload, context_rule_ids})). */
export function authDigest(account: string, signaturePayload: Buffer, ruleIds: number[]): Buffer {
  return sha256(struct({
    account: addr(account), signature_payload: bytes(signaturePayload), context_rule_ids: vec(ruleIds.map(u32)),
  }).toXDR());
}

export function authPayload(signers: [xdr.ScVal, Buffer][], ruleIds: number[]): xdr.ScVal {
  return struct({
    signers: map(signers.map(([s, b]) => [s, bytes(b)])),
    context_rule_ids: vec(ruleIds.map(u32)),
  });
}

/** Soroban `signature_payload` for an address-credentialed auth entry. */
export function sorobanAuthPayload(entry: xdr.SorobanAuthorizationEntry, networkPassphrase: string, expiration: number): Buffer {
  return Buffer.from(hash(Buffer.from(buildAuthorizationEntryPreimage(entry, expiration, networkPassphrase).toXDR())));
}

export function contractAddressOf(entry: xdr.SorobanAuthorizationEntry): string | undefined {
  const cr: any = entry.credentials;
  const c = cr.type === "sorobanCredentialsAddress" ? cr.address
    : cr.type === "sorobanCredentialsAddressV2" ? (cr.addressV2 ?? cr.address)
    : cr.type === "sorobanCredentialsAddressWithDelegates" ? cr.addressWithDelegates.addressCredentials : undefined;
  return c ? Address.fromScAddress(c.address).toString() : undefined;
}

// WebAuthn (secp256r1 passkey) owner support for OZ smart accounts.
// key_data = 65-byte uncompressed P-256 pubkey ++ credentialId (OZ webauthn verifier / smart-account-kit format).
// sig_data = XDR ScMap { authenticator_data, client_data, signature(64B compact, low-S) }.
import { xdr } from "@stellar/stellar-sdk";
import { signerExternal, authDigest, authPayload } from "./encoding.js";
import type { AuthSigner } from "./chain.js";

export interface PasskeyCred { publicKey: Buffer; credentialId: Buffer }
export const passkeyKeyData = (c: PasskeyCred) => {
  if (c.publicKey.length !== 65 || c.publicKey[0] !== 4) throw new Error("passkey pubkey must be 65-byte uncompressed P-256");
  return Buffer.concat([c.publicKey, c.credentialId]);
};
export const passkeySigner = (webauthnVerifier: string, c: PasskeyCred) => signerExternal(webauthnVerifier, passkeyKeyData(c));

const N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
/** DER ECDSA -> 64-byte r||s with low-S (required by the verifier). */
export function compactSignature(der: Buffer): Buffer {
  if (der[0] !== 0x30 || der[2] !== 0x02) throw new Error("malformed DER signature");
  const rl = der[3], r = der.subarray(4, 4 + rl);
  if (der[4 + rl] !== 0x02) throw new Error("malformed DER signature");
  const s = der.subarray(6 + rl, 6 + rl + der[5 + rl]);
  let sv = BigInt("0x" + s.toString("hex"));
  if (sv > N / 2n) sv = N - sv;
  const pad = (b: bigint) => Buffer.from(b.toString(16).padStart(64, "0"), "hex");
  return Buffer.concat([pad(BigInt("0x" + r.toString("hex"))), pad(sv)]);
}

export interface WebAuthnAssertion { authenticatorData: Buffer; clientDataJSON: Buffer; signature: Buffer /* DER */ }
export function webauthnSigData(a: WebAuthnAssertion): Buffer {
  const e = (k: string, v: Buffer) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: xdr.ScVal.scvBytes(v) });
  return Buffer.from(xdr.ScVal.scvMap([e("authenticator_data", a.authenticatorData), e("client_data", a.clientDataJSON), e("signature", compactSignature(a.signature))]).toXDR());
}

/** AuthSigner for the owner rule that asks an external party (the browser) to sign auth_digest with the passkey. */
export function passkeyOwnerAuth(account: string, verifier: string, cred: PasskeyCred, ruleIds: number[],
  requestAssertion: (challenge: Buffer) => Promise<WebAuthnAssertion>): AuthSigner {
  return async (_e, payload) => {
    const digest = authDigest(account, payload, ruleIds);
    const a = await requestAssertion(digest);
    const cd = JSON.parse(a.clientDataJSON.toString());
    if (Buffer.from(cd.challenge, "base64url").toString("hex") !== digest.toString("hex")) throw new Error("passkey signed a different challenge");
    return authPayload([[passkeySigner(verifier, cred), webauthnSigData(a)]], ruleIds);
  };
}

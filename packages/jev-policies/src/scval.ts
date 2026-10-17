// Minimal, explicit ScVal builders matching soroban-sdk #[contracttype] encodings.
import { Address, xdr, nativeToScVal } from "@stellar/stellar-sdk";

export const sym = (s: string) => xdr.ScVal.scvSymbol(s);
export const str = (s: string) => xdr.ScVal.scvString(s);
export const u32 = (n: number) => xdr.ScVal.scvU32(n);
export const i128 = (n: bigint | number) => nativeToScVal(BigInt(n), { type: "i128" });
export const bytes = (b: Uint8Array | Buffer) => xdr.ScVal.scvBytes(Buffer.from(b));
export const addr = (a: string) => new Address(a).toScVal();
export const vec = (items: xdr.ScVal[]) => xdr.ScVal.scvVec(items);
export const none = () => xdr.ScVal.scvVoid();
/** Rust enum tuple variant: Variant(a, b) => Vec[Symbol("Variant"), a, b]. */
export const enumVariant = (name: string, ...fields: xdr.ScVal[]) => vec([sym(name), ...fields]);

function cmpBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** Ordering compatible with the Soroban host for the key types we use. */
export function cmpScVal(a: xdr.ScVal, b: xdr.ScVal): number {
  const ta = (a.toXdrObject() as any).type as number, tb = (b.toXdrObject() as any).type as number;
  if (ta !== tb) return ta - tb;
  const A = a as any, B = b as any;
  switch (a.type) {
    case "scvSymbol": case "scvString": return cmpBytes(Buffer.from(String(A.value)), Buffer.from(String(B.value)));
    case "scvBytes": return cmpBytes(Buffer.from(A.value), Buffer.from(B.value));
    case "scvU32": return A.u32 - B.u32;
    case "scvAddress": return cmpBytes(A.address.toXDR(), B.address.toXDR());
    case "scvVec": {
      const va: xdr.ScVal[] = A.vec ?? [], vb: xdr.ScVal[] = B.vec ?? [];
      for (let i = 0; i < Math.min(va.length, vb.length); i++) {
        const c = cmpScVal(va[i], vb[i]);
        if (c) return c;
      }
      return va.length - vb.length;
    }
    default: return cmpBytes(a.toXDR(), b.toXDR());
  }
}

export function map(entries: [xdr.ScVal, xdr.ScVal][]): xdr.ScVal {
  const sorted = [...entries].sort((x, y) => cmpScVal(x[0], y[0]));
  return xdr.ScVal.scvMap(sorted.map(([key, val]) => new xdr.ScMapEntry({ key, val })));
}

/** #[contracttype] struct => ScMap with Symbol keys sorted. */
export function struct(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  return map(Object.entries(fields).map(([k, v]) => [sym(k), v]));
}

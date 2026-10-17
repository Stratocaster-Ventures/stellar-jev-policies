# Message and digest format

## JevKey (compact key_data, version 1)

OZ caps external `key_data` at 256 bytes; an XDR map with field names is larger, so the key uses a fixed binary layout (big-endian):

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | version = 1 |
| 1 | 1 | k |
| 2 | 1 | n (<= 4) |
| 3 | 4 | tau_allow_ppm (u32) |
| 7 | 4 | template_id (u32) |
| 11 | 4 | max_age_ledgers (u32) |
| 15 | 32 | model_id = sha256(model version string, e.g. "jev-1.13.0") |
| 47 | 32 | intent_hash = sha256(canonical intent JSON) |
| 79 | 32·n | operator ed25519 public keys |

Total `79 + 32n` bytes (<= 207). [TODO: specify the canonical intent JSON serialization in the spec, currently defined by `packages/jev-policies/src/encoding.ts`.]

## Decision message

```
DecisionBody { auth_digest: BytesN<32>, verdict: u32, p_allow_ppm: u32, model_id: BytesN<32>,
               intent_hash: BytesN<32>, template_id: u32, issued_ledger: u32, expiry_ledger: u32 }
msg = sha256( XDR(DecisionBody) )        // soroban contracttype XDR encoding
```

`auth_digest` is the OZ smart-account auth digest for the exact authorization entry, so a decision cannot be replayed on another transaction. Verdict: 0 deny, 1 allow, 2 escalate. `p_allow_ppm` is p(allow) x 1,000,000.

## Signature data (in `AuthPayload.signers[External(jev_verifier, key_data)]`)

```
JevDecision { verdict, p_allow_ppm, model_id, intent_hash, template_id, issued_ledger, expiry_ledger,
              sigs: Vec<OperatorSig{ idx: u32, sig: BytesN<64> }> }   // XDR
```

# Contract spec (normative)

Key words MUST, MUST NOT, SHOULD follow RFC 2119. Source of truth: `contracts/jev_verifier/src/lib.rs`, `contracts/jev_policy/src/lib.rs`. Toolchain: soroban-sdk 28.0.0, OZ stellar-contracts `8e25220` (v0.7.3 security fix, sdk 28).

## jev_verifier (implements OZ `Verifier`, `KeyData = Bytes`, `SigData = Bytes`)

| Function | Behaviour |
|---|---|
| `verify(hash: Bytes, key_data: Bytes, sig_data: Bytes) -> bool` | See rules V1–V7 |
| `canonicalize_key(key_data) -> Bytes` | `sha256(encode_key(decode_key(key_data)))` |
| `batch_canonicalize_key(Vec<Bytes>) -> Vec<Bytes>` | Map of the above |
| `encode_key(key: JevKey) -> Bytes` | Client helper; MUST round-trip through `decode_key` |
| `decision_msg(auth_digest, decision) -> BytesN<32>` | Client helper; the message operators sign |

Rules:

- V1. `hash` MUST be 32 bytes, else panic `InvalidHashLength` (4102).
- V2. `key_data` MUST decode (version 1, length `79 + 32n`), else `MalformedKey` (4100); `1 <= k <= n <= 4`, `tau <= 1_000_000`, `max_age > 0`, else `InvalidKeyParams` (4103).
- V3. `sig_data` MUST decode as XDR `JevDecision`, else `MalformedDecision` (4101).
- V4. Return false unless `verdict == 1 (ALLOW)` and `tau <= p_allow_ppm <= 1_000_000`. DENY (0) and ESCALATE (2) are vetoes.
- V5. Return false unless `model_id`, `intent_hash`, `template_id` equal the key's.
- V6. Return false unless `issued <= ledger.sequence <= expiry` and `expiry - issued <= max_age_ledgers`.
- V7. `sigs.len()` MUST equal `k`; indices strictly ascending and in range; each `ed25519_verify(operators[idx], decision_msg, sig)` MUST succeed (an invalid signature traps: fail-closed).

The verifier has no storage and no admin.

## jev_policy (implements OZ `Policy`, `AccountParams = JevPolicyParams`)

| Function | Auth | Behaviour |
|---|---|---|
| `install(params, rule, account)` | `account.require_auth()` | Validates and stores params |
| `enforce(context, authenticated_signers, rule, account)` | `account.require_auth()` | Checks P1–P4, emits event |
| `uninstall(rule, account)` | `account.require_auth()` | Removes params |
| `get_params(account, rule_id)` | none | Read |

Install rules: allowlist non-empty and `<= 32`; token rules `<= 32`; no negative `max_amount` (else 4208); Jev signer MUST be in `rule.signers` (4203); not already installed (4201). The `spending_limit` presence is not checked at install because OZ installs policies in map order; it is checked on every call (P1).

Enforce rules (each failure panics = deny):

- P1. `rule.policies` MUST contain `params.spending_limit` (4202).
- P2. `authenticated_signers` MUST contain `params.jev_signer` (4203).
- P3. Context MUST be a contract call (4205) whose `(contract, fn_name)` is allowlisted (4204).
- P4. If a token rule exists for the contract and `fn` is `transfer` or `approve`: `args[2]` MUST be a non-negative i128 (4209) and `<= max_amount` (4206); for `transfer` with non-empty recipients, `args[1]` MUST be listed (4207).

## Storage

| Contract | Key | Type | Durability | TTL |
|---|---|---|---|---|
| jev_policy | `StorageKey::Params(Address, u32)` | `JevPolicyParams{jev_signer, spending_limit, allowlist: Vec<AllowedCall>, token_rules: Vec<TokenRule>}` | persistent | extended to 60 days when below 30 days, on install and every load |

## Authorization model

The smart account's `__check_auth` (OZ) selects the context rule, calls each signer's verifier, then each policy's `enforce`. Both `simple_threshold(2)` (agent + Jev) and `jev_policy` P2 require the Jev signer, so Jev is mandatory twice (defense in depth). Policy mutations require the account's own auth, i.e. the owner rule.

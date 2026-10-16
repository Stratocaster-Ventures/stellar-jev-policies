//! # jev_verifier — OpenZeppelin `Verifier` carrying Jev decisions
//!
//! Installed on an OZ smart account as `Signer::External(jev_verifier, xdr(JevKey))`.
//! The Jev operator (an off-chain service that calls TypeSafe's Jev model) co-signs the
//! exact OZ `auth_digest` together with its decision. A `simple_threshold` 2-of-2 policy
//! on the same context rule makes the agent key AND the Jev signer mandatory, so a single
//! transaction carries both signatures in `AuthPayload.signers`.
//!
//! `verify` returns `true` only when:
//! - `verdict == ALLOW` (deny / escalate are vetoes) and `p_allow_ppm >= tau_allow_ppm`
//! - `model_id`, `intent_hash`, `template_id` equal those pinned in the key at grant time
//! - `issued_ledger <= now <= expiry_ledger` and `expiry - issued <= max_age_ledgers`
//! - `k` signatures from distinct operators (strictly ascending indices) over
//!   `sha256(xdr(DecisionBody{ auth_digest, ... }))` all verify (ed25519 traps on a bad sig,
//!   so failure is fail-closed).
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, xdr::{FromXdr, ToXdr}, Bytes,
    BytesN, Env, Vec,
};
use stellar_accounts::verifiers::Verifier;

pub const VERDICT_DENY: u32 = 0;
pub const VERDICT_ALLOW: u32 = 1;
pub const VERDICT_ESCALATE: u32 = 2;
pub const PPM: u32 = 1_000_000;
pub const MAX_OPERATORS: u32 = 8;

/// Grant-time key, committed by the user's passkey when the context rule is added.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct JevKey {
    /// ed25519 public keys of the Jev operator set (POC: inline; prod: operator_registry + epoch).
    pub operators: Vec<BytesN<32>>,
    /// Required number of operator signatures.
    pub k: u32,
    /// sha256 of the pinned, versioned model id (e.g. "jev-1.13.0"). Never "latest".
    pub model_id: BytesN<32>,
    /// sha256(canonical intent JSON) signed by the user at grant time.
    pub intent_hash: BytesN<32>,
    /// Calibrated p(allow) threshold in parts-per-million.
    pub tau_allow_ppm: u32,
    pub template_id: u32,
    /// Max decision lifetime in ledgers (~5s each).
    pub max_age_ledgers: u32,
}

/// What operators sign. Binds the decision to the exact OZ auth digest.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct DecisionBody {
    pub auth_digest: BytesN<32>,
    pub verdict: u32,
    pub p_allow_ppm: u32,
    pub model_id: BytesN<32>,
    pub intent_hash: BytesN<32>,
    pub template_id: u32,
    pub issued_ledger: u32,
    pub expiry_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct OperatorSig {
    pub idx: u32,
    pub sig: BytesN<64>,
}

/// Signature data placed in `AuthPayload.signers[jev_signer]` as XDR.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct JevDecision {
    pub verdict: u32,
    pub p_allow_ppm: u32,
    pub model_id: BytesN<32>,
    pub intent_hash: BytesN<32>,
    pub template_id: u32,
    pub issued_ledger: u32,
    pub expiry_ledger: u32,
    pub sigs: Vec<OperatorSig>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum JevVerifierError {
    MalformedKey = 4100,
    MalformedDecision = 4101,
    InvalidHashLength = 4102,
    InvalidKeyParams = 4103,
}

pub fn decode_key(e: &Env, key_data: &Bytes) -> JevKey {
    let key = JevKey::from_xdr(e, key_data)
        .unwrap_or_else(|_| panic_with_error!(e, JevVerifierError::MalformedKey));
    let n = key.operators.len();
    if key.k == 0 || key.k > n || n > MAX_OPERATORS || key.tau_allow_ppm > PPM || key.max_age_ledgers == 0 {
        panic_with_error!(e, JevVerifierError::InvalidKeyParams)
    }
    key
}

pub fn decision_message(e: &Env, auth_digest: &BytesN<32>, d: &JevDecision) -> BytesN<32> {
    let body = DecisionBody {
        auth_digest: auth_digest.clone(),
        verdict: d.verdict,
        p_allow_ppm: d.p_allow_ppm,
        model_id: d.model_id.clone(),
        intent_hash: d.intent_hash.clone(),
        template_id: d.template_id,
        issued_ledger: d.issued_ledger,
        expiry_ledger: d.expiry_ledger,
    };
    e.crypto().sha256(&body.to_xdr(e)).to_bytes()
}

pub fn verify_decision(e: &Env, hash: &Bytes, key: &JevKey, d: &JevDecision) -> bool {
    if hash.len() != 32 {
        panic_with_error!(e, JevVerifierError::InvalidHashLength)
    }
    let auth_digest: BytesN<32> = hash.clone().try_into().unwrap();
    // Veto + calibrated threshold.
    if d.verdict != VERDICT_ALLOW || d.p_allow_ppm > PPM || d.p_allow_ppm < key.tau_allow_ppm {
        return false;
    }
    // Grant-time commitments.
    if d.model_id != key.model_id || d.intent_hash != key.intent_hash || d.template_id != key.template_id {
        return false;
    }
    // Freshness.
    let now = e.ledger().sequence();
    if d.issued_ledger > now || now > d.expiry_ledger || d.expiry_ledger < d.issued_ledger {
        return false;
    }
    if d.expiry_ledger - d.issued_ledger > key.max_age_ledgers {
        return false;
    }
    // Exactly k signatures, strictly ascending operator indices.
    if d.sigs.len() != key.k {
        return false;
    }
    let msg: Bytes = decision_message(e, &auth_digest, d).into();
    let mut last: Option<u32> = None;
    for s in d.sigs.iter() {
        if let Some(l) = last {
            if s.idx <= l {
                return false;
            }
        }
        last = Some(s.idx);
        let Some(pk) = key.operators.get(s.idx) else { return false };
        // Traps on an invalid signature: fail-closed.
        e.crypto().ed25519_verify(&pk, &msg, &s.sig);
    }
    true
}

#[contract]
pub struct JevVerifier;

#[contractimpl]
impl Verifier for JevVerifier {
    type KeyData = Bytes;
    type SigData = Bytes;

    fn verify(e: &Env, hash: Bytes, key_data: Bytes, sig_data: Bytes) -> bool {
        let key = decode_key(e, &key_data);
        let d = JevDecision::from_xdr(e, &sig_data)
            .unwrap_or_else(|_| panic_with_error!(e, JevVerifierError::MalformedDecision));
        verify_decision(e, &hash, &key, &d)
    }

    /// Canonical identity = sha256 of the re-encoded key, so two encodings of one key collide.
    fn canonicalize_key(e: &Env, key_data: Bytes) -> Bytes {
        let key = decode_key(e, &key_data);
        e.crypto().sha256(&key.to_xdr(e)).to_bytes().into()
    }

    fn batch_canonicalize_key(e: &Env, keys_data: Vec<Bytes>) -> Vec<Bytes> {
        let mut out = Vec::new(e);
        for k in keys_data.iter() {
            out.push_back(Self::canonicalize_key(e, k));
        }
        out
    }
}

#[contractimpl]
impl JevVerifier {
    /// Helper for clients: the 32-byte message operators must sign.
    pub fn decision_msg(e: Env, auth_digest: BytesN<32>, decision: JevDecision) -> BytesN<32> {
        decision_message(&e, &auth_digest, &decision)
    }
}

#[cfg(test)]
mod test;

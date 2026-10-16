extern crate std;
use super::*;
use ed25519_dalek::{Signer as _, SigningKey};
use soroban_sdk::{testutils::Ledger, vec, Bytes, BytesN, Env};

fn sk(seed: u8) -> SigningKey { SigningKey::from_bytes(&[seed; 32]) }
fn pk(e: &Env, k: &SigningKey) -> BytesN<32> { BytesN::from_array(e, &k.verifying_key().to_bytes()) }

struct F { e: Env, id: soroban_sdk::Address, ops: std::vec::Vec<SigningKey>, key: JevKey, digest: BytesN<32> }

fn setup(k: u32) -> F {
    let e = Env::default();
    e.ledger().set_sequence_number(1000);
    let id = e.register(JevVerifier, ());
    let ops = std::vec![sk(1), sk(2), sk(3)];
    let key = JevKey {
        operators: vec![&e, pk(&e, &ops[0]), pk(&e, &ops[1]), pk(&e, &ops[2])],
        k, model_id: BytesN::from_array(&e, &[7; 32]), intent_hash: BytesN::from_array(&e, &[9; 32]),
        tau_allow_ppm: 900_000, template_id: 1, max_age_ledgers: 12,
    };
    let digest = BytesN::from_array(&e, &[42; 32]);
    F { e, id, ops, key, digest }
}

fn decision(f: &F, verdict: u32, p: u32, signers: &[u32]) -> JevDecision {
    let e = &f.e;
    let mut d = JevDecision { verdict, p_allow_ppm: p, model_id: f.key.model_id.clone(), intent_hash: f.key.intent_hash.clone(),
        template_id: 1, issued_ledger: 998, expiry_ledger: 1008, sigs: vec![e] };
    sign(f, &mut d, signers);
    d
}
fn sign(f: &F, d: &mut JevDecision, signers: &[u32]) {
    let e = &f.e;
    d.sigs = vec![e];
    let msg = decision_message(e, &f.digest, d).to_array();
    for &i in signers {
        let s = f.ops[i as usize].sign(&msg).to_bytes();
        d.sigs.push_back(OperatorSig { idx: i, sig: BytesN::from_array(e, &s) });
    }
}

fn verify(f: &F, d: &JevDecision) -> bool {
    let c = JevVerifierClient::new(&f.e, &f.id);
    c.verify(&f.digest.clone().into(), &encode_key(&f.e, &f.key), &d.clone().to_xdr(&f.e))
}

#[test] fn allow_above_threshold_passes() { let f = setup(1); assert!(verify(&f, &decision(&f, VERDICT_ALLOW, 950_000, &[0]))); }
#[test] fn below_threshold_rejected() { let f = setup(1); assert!(!verify(&f, &decision(&f, VERDICT_ALLOW, 899_999, &[0]))); }
#[test] fn exactly_threshold_passes() { let f = setup(1); assert!(verify(&f, &decision(&f, VERDICT_ALLOW, 900_000, &[0]))); }
#[test] fn deny_is_veto() { let f = setup(1); assert!(!verify(&f, &decision(&f, VERDICT_DENY, 999_999, &[0]))); }
#[test] fn escalate_is_veto() { let f = setup(1); assert!(!verify(&f, &decision(&f, VERDICT_ESCALATE, 999_999, &[0]))); }
#[test] fn wrong_model_rejected() { let f = setup(1); let mut d = decision(&f, 1, 950_000, &[0]); d.model_id = BytesN::from_array(&f.e, &[8; 32]); sign(&f, &mut d, &[0]); assert!(!verify(&f, &d)); }
#[test] fn wrong_intent_rejected() { let f = setup(1); let mut d = decision(&f, 1, 950_000, &[0]); d.intent_hash = BytesN::from_array(&f.e, &[1; 32]); sign(&f, &mut d, &[0]); assert!(!verify(&f, &d)); }
#[test] fn wrong_template_rejected() { let f = setup(1); let mut d = decision(&f, 1, 950_000, &[0]); d.template_id = 2; sign(&f, &mut d, &[0]); assert!(!verify(&f, &d)); }
#[test] fn expired_rejected() { let f = setup(1); let d = decision(&f, 1, 950_000, &[0]); f.e.ledger().set_sequence_number(1009); assert!(!verify(&f, &d)); }
#[test] fn future_issued_rejected() { let f = setup(1); let mut d = decision(&f, 1, 950_000, &[0]); d.issued_ledger = 1001; sign(&f, &mut d, &[0]); assert!(!verify(&f, &d)); }
#[test] fn too_long_lived_rejected() { let f = setup(1); let mut d = decision(&f, 1, 950_000, &[0]); d.issued_ledger = 990; d.expiry_ledger = 1003; sign(&f, &mut d, &[0]); assert!(!verify(&f, &d)); }
#[test] fn two_of_three_passes() { let f = setup(2); assert!(verify(&f, &decision(&f, 1, 950_000, &[0, 2]))); }
#[test] fn too_few_sigs_rejected() { let f = setup(2); assert!(!verify(&f, &decision(&f, 1, 950_000, &[1]))); }
#[test] fn duplicate_operator_rejected() { let f = setup(2); assert!(!verify(&f, &decision(&f, 1, 950_000, &[1, 1]))); }
#[test] fn descending_indices_rejected() { let f = setup(2); assert!(!verify(&f, &decision(&f, 1, 950_000, &[2, 0]))); }
#[test] fn unknown_operator_rejected() { let f = setup(1); let mut d = decision(&f, 1, 950_000, &[0]); d.sigs.set(0, OperatorSig { idx: 5, sig: d.sigs.get(0).unwrap().sig }); assert!(!verify(&f, &d)); }
#[test] #[should_panic] fn signature_over_other_digest_traps() {
    let f = setup(1); let mut d = decision(&f, 1, 950_000, &[0]);
    // tamper p_allow after signing -> signature no longer matches
    d.p_allow_ppm = 960_000; verify(&f, &d);
}
#[test] #[should_panic] fn wrong_operator_key_traps() {
    let f = setup(1); let mut d = decision(&f, 1, 950_000, &[1]); // signed by op 1
    let s = d.sigs.get(0).unwrap().sig; d.sigs.set(0, OperatorSig { idx: 0, sig: s }); verify(&f, &d);
}
#[test] #[should_panic(expected = "Error(Contract, #4103)")] fn k_zero_key_rejected() {
    let mut f = setup(1); f.key.k = 0; let d = decision(&f, 1, 950_000, &[0]); verify(&f, &d);
}
#[test] #[should_panic] fn malformed_decision_traps() {
    let f = setup(1); let c = JevVerifierClient::new(&f.e, &f.id);
    c.verify(&f.digest.clone().into(), &encode_key(&f.e, &f.key), &Bytes::from_array(&f.e, &[1, 2, 3]));
}
#[test] fn canonicalize_is_stable() {
    let f = setup(1); let c = JevVerifierClient::new(&f.e, &f.id);
    let a = c.canonicalize_key(&encode_key(&f.e, &f.key));
    assert_eq!(a, c.canonicalize_key(&encode_key(&f.e, &f.key)));
    let mut k2 = f.key.clone(); k2.tau_allow_ppm = 1; assert_ne!(a, c.canonicalize_key(&encode_key(&f.e, &k2)));
}

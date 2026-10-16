//! End-to-end `__check_auth` tests: real OZ smart account + ed25519 agent signer +
//! jev_verifier co-signer + simple_threshold(2) + spending_limit + jev_policy.
extern crate std;
use super::*;
use ed25519_dalek::{Signer as _, SigningKey};
use jev_verifier::{decision_message, JevDecision, JevKey, JevVerifier, OperatorSig, VERDICT_ALLOW, VERDICT_DENY};
use oz_ed25519_verifier::Ed25519VerifierContract;
use oz_simple_threshold::ThresholdPolicyContract;
use oz_smart_account::MultisigContract;
use oz_spending_limit::SpendingLimitPolicyContract;
use soroban_sdk::{
    auth::{Context, ContractContext},
    map, symbol_short, testutils::{Address as _, Ledger}, vec, xdr::ToXdr, Address, Bytes, BytesN, Env, IntoVal, Map, String, Symbol, Val,
};
use stellar_accounts::{
    policies::{simple_threshold::SimpleThresholdAccountParams, spending_limit::SpendingLimitAccountParams},
    smart_account::{AuthDigestPreimage, AuthPayload, ContextRuleType, SmartAccountClient},
};

const RULE: u32 = 1;

struct W {
    e: Env, account: Address, token: Address, other: Address, merchant: Address,
    agent_sk: SigningKey, agent: Signer, op_sk: SigningKey, jev: Signer, jkey: JevKey,
    spending: Address, jev_policy: Address, threshold: Address,
}

fn setup() -> W { setup_with(1_000, 500) }

fn setup_with(limit: i128, per_call: i128) -> W {
    let e = Env::default();
    e.ledger().set_sequence_number(1000);
    let ed = e.register(Ed25519VerifierContract, ());
    let jv = e.register(JevVerifier, ());
    let threshold = e.register(ThresholdPolicyContract, ());
    let spending = e.register(SpendingLimitPolicyContract, ());
    let jev_policy = e.register(JevPolicy, ());
    let token = e.register_stellar_asset_contract_v2(Address::generate(&e)).address();
    let other = Address::generate(&e);
    let merchant = Address::generate(&e);

    let agent_sk = SigningKey::from_bytes(&[11; 32]);
    let op_sk = SigningKey::from_bytes(&[22; 32]);
    let agent = Signer::External(ed.clone(), Bytes::from_array(&e, &agent_sk.verifying_key().to_bytes()));
    let jkey = JevKey {
        operators: vec![&e, BytesN::from_array(&e, &op_sk.verifying_key().to_bytes())],
        k: 1, model_id: BytesN::from_array(&e, &[7; 32]), intent_hash: BytesN::from_array(&e, &[9; 32]),
        tau_allow_ppm: 900_000, template_id: 1, max_age_ledgers: 12,
    };
    let jev = Signer::External(jv.clone(), jev_verifier::encode_key(&e, &jkey));
    let params = JevPolicyParams {
        jev_signer: jev.clone(), spending_limit: spending.clone(),
        allowlist: vec![&e, AllowedCall { contract: token.clone(), fn_name: symbol_short!("transfer") }],
        token_rules: vec![&e, TokenRule { token: token.clone(), max_amount: per_call, recipients: vec![&e, merchant.clone()] }],
    };
    let policies: Map<Address, Val> = map![&e,
        (threshold.clone(), SimpleThresholdAccountParams { threshold: 2 }.into_val(&e)),
        (spending.clone(), SpendingLimitAccountParams { spending_limit: limit, period_ledgers: 17_280 }.into_val(&e)),
        (jev_policy.clone(), params.into_val(&e))
    ];
    // Default rule: owner only (stand-in for the user's passkey / WebAuthn signer).
    let owner_sk = SigningKey::from_bytes(&[33; 32]);
    let owner = Signer::External(ed.clone(), Bytes::from_array(&e, &owner_sk.verifying_key().to_bytes()));
    let account = e.register(MultisigContract, (vec![&e, owner], Map::<Address, Val>::new(&e)));
    // Agent session rule: OZ spending_limit only installs on CallContract rules, so sessions
    // are token-scoped: one CallContract(token) rule per asset the agent may move.
    e.mock_all_auths();
    let rule = SmartAccountClient::new(&e, &account).add_context_rule(
        &ContextRuleType::CallContract(token.clone()), &String::from_str(&e, "jev-agent-session"),
        &None, &vec![&e, agent.clone(), jev.clone()], &policies);
    assert_eq!(rule.id, 1);
    e.set_auths(&[]);
    W { e, account, token, other, merchant, agent_sk, agent, op_sk, jev, jkey, spending, jev_policy, threshold }
}

fn transfer_ctx(w: &W, to: &Address, amount: i128) -> Context {
    call_ctx(w, &w.token, symbol_short!("transfer"), vec![&w.e, w.account.clone().into_val(&w.e), to.into_val(&w.e), amount.into_val(&w.e)])
}
fn call_ctx(_w: &W, c: &Address, f: Symbol, args: soroban_sdk::Vec<Val>) -> Context {
    Context::Contract(ContractContext { contract: c.clone(), fn_name: f, args })
}

struct Opts { verdict: u32, p: u32, with_jev: bool, with_agent: bool }
fn ok() -> Opts { Opts { verdict: VERDICT_ALLOW, p: 950_000, with_jev: true, with_agent: true } }

fn check(w: &W, ctx: Context, o: Opts) -> bool { check_err(w, ctx, o).is_none() }

fn check_err(w: &W, ctx: Context, o: Opts) -> Option<std::string::String> {
    let e = &w.e;
    let payload = BytesN::from_array(e, &[5; 32]);
    let pre = AuthDigestPreimage { account: w.account.clone(), signature_payload: payload.clone(), context_rule_ids: vec![e, RULE] };
    let digest = pre.digest(e);
    let mut signers = Map::new(e);
    if o.with_agent {
        let s = w.agent_sk.sign(&digest.to_array()).to_bytes();
        signers.set(w.agent.clone(), Bytes::from_array(e, &s));
    }
    if o.with_jev {
        let now = e.ledger().sequence();
        let mut d = JevDecision { verdict: o.verdict, p_allow_ppm: o.p, model_id: w.jkey.model_id.clone(), intent_hash: w.jkey.intent_hash.clone(),
            template_id: 1, issued_ledger: now, expiry_ledger: now + 12, sigs: vec![e] };
        let m = decision_message(e, &digest, &d).to_array();
        d.sigs.push_back(OperatorSig { idx: 0, sig: BytesN::from_array(e, &w.op_sk.sign(&m).to_bytes()) });
        signers.set(w.jev.clone(), d.to_xdr(e));
    }
    let ap = AuthPayload { signers, context_rule_ids: vec![e, RULE] };
    e.try_invoke_contract_check_auth::<soroban_sdk::Error>(&w.account, &payload, ap.into_val(e), &vec![e, ctx]).err().map(|er| std::format!("{:?}", er))
}

fn denied_with(w: &W, ctx: Context, o: Opts, code: u32) {
    let er = check_err(w, ctx, o).expect("expected deny");
    assert!(er.contains(&std::format!("#{}", code)), "wanted #{} got {}", code, er);
}

#[test] fn allowed_transfer_passes() { let w = setup(); assert!(check(&w, transfer_ctx(&w, &w.merchant, 100), ok())); }

#[test] fn spending_limit_accumulates_and_denies() {
    let w = setup();
    assert!(check(&w, transfer_ctx(&w, &w.merchant, 500), ok()));
    assert!(check(&w, transfer_ctx(&w, &w.merchant, 500), ok()));
    assert!(!check(&w, transfer_ctx(&w, &w.merchant, 1), ok()), "window exhausted");
}

#[test] fn per_call_token_cap_denies() { let w = setup(); denied_with(&w, transfer_ctx(&w, &w.merchant, 501), ok(), 4206); }
#[test] fn recipient_not_allowlisted_denies() { let w = setup(); denied_with(&w, transfer_ctx(&w, &w.other, 10), ok(), 4207); }
#[test] fn function_not_allowlisted_denies() {
    let w = setup();
    let args = vec![&w.e, w.account.clone().into_val(&w.e), w.other.into_val(&w.e), 10i128.into_val(&w.e), 2000u32.into_val(&w.e)];
    denied_with(&w, call_ctx(&w, &w.token, symbol_short!("approve"), args), ok(), 3223 /* OZ spending_limit NotAllowed: non-transfer calls rejected before jev_policy */);
}
#[test] fn contract_not_allowlisted_denies() {
    let w = setup(); let rogue = Address::generate(&w.e);
    let args = vec![&w.e, w.account.clone().into_val(&w.e), w.merchant.into_val(&w.e), 10i128.into_val(&w.e)];
    assert!(!check(&w, call_ctx(&w, &rogue, symbol_short!("transfer"), args), ok()));
}
#[test] fn jev_deny_vetoes() { let w = setup(); denied_with(&w, transfer_ctx(&w, &w.merchant, 10), Opts { verdict: VERDICT_DENY, ..ok() }, 3003 /* ExternalVerificationFailed */); }
#[test] fn jev_low_confidence_denies() { let w = setup(); assert!(!check(&w, transfer_ctx(&w, &w.merchant, 10), Opts { p: 800_000, ..ok() })); }
#[test] fn missing_jev_cosign_denies() { let w = setup(); assert!(!check(&w, transfer_ctx(&w, &w.merchant, 10), Opts { with_jev: false, ..ok() })); }
#[test] fn jev_alone_cannot_spend() { let w = setup(); assert!(!check(&w, transfer_ctx(&w, &w.merchant, 10), Opts { with_agent: false, ..ok() })); }

#[test] fn removing_spending_limit_fails_closed() {
    let w = setup();
    let c = SmartAccountClient::new(&w.e, &w.account);
    w.e.mock_all_auths();
    let pid = c.get_policy_id(&w.spending);
    c.remove_policy(&RULE, &pid);
    w.e.set_auths(&[]);
    denied_with(&w, transfer_ctx(&w, &w.merchant, 10), ok(), 4202);
}

#[test] fn params_are_readable_and_uninstall_clears() {
    let w = setup();
    let pc = JevPolicyClient::new(&w.e, &w.jev_policy);
    assert_eq!(pc.get_params(&w.account, &RULE).spending_limit, w.spending);
    let c = SmartAccountClient::new(&w.e, &w.account);
    w.e.mock_all_auths();
    c.remove_policy(&RULE, &c.get_policy_id(&w.jev_policy));
    assert!(pc.try_get_params(&w.account, &RULE).is_err());
    let _ = &w.threshold;
}

#[test] fn fresh_decision_at_later_ledger_passes() {
    let w = setup();
    w.e.ledger().set_sequence_number(5000);
    assert!(check(&w, transfer_ctx(&w, &w.merchant, 10), ok()));
}

#[test] fn owner_rule_cannot_be_used_by_agent() {
    // Agent + Jev try to authorize through the owner's Default rule (id 0): unauthorized signers.
    let w = setup();
    let e = &w.e;
    let payload = BytesN::from_array(e, &[5; 32]);
    let pre = AuthDigestPreimage { account: w.account.clone(), signature_payload: payload.clone(), context_rule_ids: vec![e, 0u32] };
    let s = w.agent_sk.sign(&pre.digest(e).to_array()).to_bytes();
    let ap = AuthPayload { signers: map![e, (w.agent.clone(), Bytes::from_array(e, &s))], context_rule_ids: vec![e, 0u32] };
    assert!(e.try_invoke_contract_check_auth::<soroban_sdk::Error>(&w.account, &payload, ap.into_val(e), &vec![e, transfer_ctx(&w, &w.merchant, 10)]).is_err());
}

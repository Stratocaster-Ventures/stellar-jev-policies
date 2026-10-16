//! # jev_policy — OpenZeppelin `Policy`: AI can only restrict
//!
//! Stacked on a context rule next to OZ `spending_limit` and `simple_threshold` (2-of-2:
//! agent key + Jev signer). `enforce` panics (= deny) unless, on **every** call:
//! - (a) the pinned `spending_limit` policy is still in `context_rule.policies`
//!   (survives a later `remove_policy`; install-time checks alone are not enough)
//! - (b) the pinned Jev signer is among `authenticated_signers`
//! - (c) the context is a contract call whose (contract, fn) is allowlisted
//! - (d) token-scoped rules: for `transfer`/`approve` the per-call amount is within the
//!   token's `max_amount`, and `transfer` recipients are restricted when configured.
//!
//! Worst-case loss with a compromised Jev operator is therefore bounded by deterministic
//! on-chain rules: `spending_limit` window + allowlist + per-token caps.
#![no_std]

use soroban_sdk::{
    auth::{Context, ContractContext},
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    symbol_short, Address, Env, Symbol, TryFromVal, Vec,
};
use stellar_accounts::{
    policies::Policy,
    smart_account::{ContextRule, Signer},
};

const DAY_LEDGERS: u32 = 17_280;
const TTL_THRESHOLD: u32 = 30 * DAY_LEDGERS;
const TTL_EXTEND: u32 = 60 * DAY_LEDGERS;
pub const MAX_ALLOWLIST: u32 = 32;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AllowedCall {
    pub contract: Address,
    pub fn_name: Symbol,
}

/// Token-scoped rule: per-call cap and optional recipient allowlist for a SEP-41 token.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TokenRule {
    pub token: Address,
    pub max_amount: i128,
    /// Empty = any recipient.
    pub recipients: Vec<Address>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct JevPolicyParams {
    pub jev_signer: Signer,
    pub spending_limit: Address,
    pub allowlist: Vec<AllowedCall>,
    pub token_rules: Vec<TokenRule>,
}

#[contracttype]
pub enum StorageKey {
    Params(Address, u32),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum JevPolicyError {
    NotInstalled = 4200,
    AlreadyInstalled = 4201,
    SpendingLimitMissing = 4202,
    JevSignerMissing = 4203,
    NotAllowlisted = 4204,
    NonContractContext = 4205,
    AmountExceedsTokenRule = 4206,
    RecipientNotAllowed = 4207,
    InvalidParams = 4208,
    BadAmount = 4209,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct JevPolicyEnforced {
    #[topic]
    pub smart_account: Address,
    pub context_rule_id: u32,
    pub contract: Address,
    pub fn_name: Symbol,
}

fn key(account: &Address, rule_id: u32) -> StorageKey {
    StorageKey::Params(account.clone(), rule_id)
}

pub fn load(e: &Env, account: &Address, rule_id: u32) -> JevPolicyParams {
    let k = key(account, rule_id);
    let p: JevPolicyParams = e
        .storage()
        .persistent()
        .get(&k)
        .unwrap_or_else(|| panic_with_error!(e, JevPolicyError::NotInstalled));
    e.storage().persistent().extend_ttl(&k, TTL_THRESHOLD, TTL_EXTEND);
    p
}

pub fn check(e: &Env, p: &JevPolicyParams, context: &Context, signers: &Vec<Signer>, rule: &ContextRule) {
    // (a) spending_limit still installed on this rule.
    if !rule.policies.contains(&p.spending_limit) {
        panic_with_error!(e, JevPolicyError::SpendingLimitMissing)
    }
    // (b) Jev operator co-signed.
    if !signers.contains(&p.jev_signer) {
        panic_with_error!(e, JevPolicyError::JevSignerMissing)
    }
    // (c) allowlist.
    let Context::Contract(ContractContext { contract, fn_name, args }) = context else {
        panic_with_error!(e, JevPolicyError::NonContractContext)
    };
    let allowed = p
        .allowlist
        .iter()
        .any(|a| &a.contract == contract && &a.fn_name == fn_name);
    if !allowed {
        panic_with_error!(e, JevPolicyError::NotAllowlisted)
    }
    // (d) token-scoped rules (SEP-41 transfer(from,to,amount) / approve(from,spender,amount,exp)).
    if let Some(rule) = p.token_rules.iter().find(|r| &r.token == contract) {
        let is_transfer = fn_name == &symbol_short!("transfer");
        if is_transfer || fn_name == &symbol_short!("approve") {
            let amount = args
                .get(2)
                .and_then(|v| i128::try_from_val(e, &v).ok())
                .unwrap_or_else(|| panic_with_error!(e, JevPolicyError::BadAmount));
            if amount < 0 {
                panic_with_error!(e, JevPolicyError::BadAmount)
            }
            if amount > rule.max_amount {
                panic_with_error!(e, JevPolicyError::AmountExceedsTokenRule)
            }
            if is_transfer && !rule.recipients.is_empty() {
                let to = args
                    .get(1)
                    .and_then(|v| Address::try_from_val(e, &v).ok())
                    .unwrap_or_else(|| panic_with_error!(e, JevPolicyError::RecipientNotAllowed));
                if !rule.recipients.contains(&to) {
                    panic_with_error!(e, JevPolicyError::RecipientNotAllowed)
                }
            }
        }
    }
}

#[contract]
pub struct JevPolicy;

#[contractimpl]
impl Policy for JevPolicy {
    type AccountParams = JevPolicyParams;

    fn enforce(e: &Env, context: Context, authenticated_signers: Vec<Signer>, context_rule: ContextRule, smart_account: Address) {
        smart_account.require_auth();
        let p = load(e, &smart_account, context_rule.id);
        check(e, &p, &context, &authenticated_signers, &context_rule);
        if let Context::Contract(c) = &context {
            JevPolicyEnforced {
                smart_account: smart_account.clone(),
                context_rule_id: context_rule.id,
                contract: c.contract.clone(),
                fn_name: c.fn_name.clone(),
            }
            .publish(e);
        }
    }

    fn install(e: &Env, install_params: JevPolicyParams, context_rule: ContextRule, smart_account: Address) {
        smart_account.require_auth();
        let p = install_params;
        if p.allowlist.is_empty() || p.allowlist.len() > MAX_ALLOWLIST || p.token_rules.len() > MAX_ALLOWLIST {
            panic_with_error!(e, JevPolicyError::InvalidParams)
        }
        if p.token_rules.iter().any(|r| r.max_amount < 0) {
            panic_with_error!(e, JevPolicyError::InvalidParams)
        }
        // Jev signer must be one of the rule's signers.
        if !context_rule.signers.contains(&p.jev_signer) {
            panic_with_error!(e, JevPolicyError::JevSignerMissing)
        }
        // NOTE: during add_context_rule policies are installed in map order, so the
        // spending_limit may not be in `context_rule.policies` yet; it is enforced on every call.
        let k = key(&smart_account, context_rule.id);
        if e.storage().persistent().has(&k) {
            panic_with_error!(e, JevPolicyError::AlreadyInstalled)
        }
        e.storage().persistent().set(&k, &p);
        e.storage().persistent().extend_ttl(&k, TTL_THRESHOLD, TTL_EXTEND);
    }

    fn uninstall(e: &Env, context_rule: ContextRule, smart_account: Address) {
        smart_account.require_auth();
        e.storage().persistent().remove(&key(&smart_account, context_rule.id));
    }
}

#[contractimpl]
impl JevPolicy {
    pub fn get_params(e: Env, smart_account: Address, context_rule_id: u32) -> JevPolicyParams {
        load(&e, &smart_account, context_rule_id)
    }
}

#[cfg(test)]
mod test;

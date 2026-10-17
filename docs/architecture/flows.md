# Flows

Testnet evidence for these flows: tx hashes and observed error codes in [`deployments/testnet.json`](../../deployments/testnet.json) and logs in `deployments/`.

## 1. Install an agent session

```mermaid
sequenceDiagram
  actor Owner as Owner (passkey)
  participant UI as Web console / CLI
  participant SA as OZ smart account
  participant P as jev_policy
  Owner->>UI: define intent (recipients, caps, purpose), pick tau=0.80
  UI->>UI: intent_hash = sha256(canonical intent JSON); model_id = sha256("jev-1.13.0")
  UI->>UI: key_data = encode_key(JevKey{operators,k,model_id,intent_hash,tau,template,max_age})
  Owner->>SA: add_context_rule(CallContract(token), signers=[agent, External(jev_verifier,key_data)],<br/>policies={simple_threshold(2), spending_limit, jev_policy(params)})
  SA->>P: install(params, rule, account)
  P->>P: require Jev signer on rule; store params; extend TTL
  SA-->>Owner: rule id (demo tx install_session)
```

## 2. Payment, allowed

```mermaid
sequenceDiagram
  participant A as Agent
  participant OP as Jev operator
  participant J as Jev API
  participant SA as Smart account
  participant V as jev_verifier
  participant Pol as Policies
  A->>OP: unsigned auth entry + claimed purpose
  OP->>J: intent + tx summary + derived facts (framing v4)
  J-->>OP: allow, p_allow=0.96
  OP->>OP: sign sha256(xdr(DecisionBody{auth_digest,...}))
  OP-->>A: JevDecision XDR
  A->>SA: submit tx (agent sig + Jev sig in AuthPayload.signers)
  SA->>V: verify(auth_digest, key_data, decision)
  V-->>SA: true
  SA->>Pol: simple_threshold 2-of-2, spending_limit, jev_policy.enforce
  Pol-->>SA: ok (JevPolicyEnforced event)
  SA-->>A: transfer executed (testnet, direct submission: demo_real_jev_v4 txs in deployments/testnet.json)
```

## 3. Escalate to the owner

Jev returns `escalate`, or `allow` with `p_allow < tau`. The operator still returns a signed decision, but `jev_verifier.verify` returns false, so the 2-of-2 threshold fails. The client routes the request to the owner, who can approve with the passkey under a separate owner rule [TODO: escalation UX beyond console simulator]. At tau 0.80, 10.7% (dev set) and 12.0% (holdout) of legitimate payments in the benchmark are escalated.

## 4. Deny

```mermaid
sequenceDiagram
  participant A as Agent (prompt-injected)
  participant OP as Jev operator
  participant SA as Smart account
  participant V as jev_verifier
  A->>OP: transfer 500 XLM to unknown G...
  OP-->>A: decision verdict=deny
  A->>SA: submit anyway
  SA->>V: verify -> false (veto)
  SA-->>A: auth fails (observed error 3003 on testnet)
```

## 5. Compromised operator

The operator key is stolen and signs `allow` for anything. On-chain rules still apply:

```mermaid
sequenceDiagram
  participant Att as Attacker (agent + operator key)
  participant SA as Smart account
  participant V as jev_verifier
  participant P as jev_policy
  participant SL as spending_limit
  Att->>SA: transfer to attacker address, signed "allow"
  SA->>V: verify -> true (signature valid)
  SA->>P: enforce -> recipient not allowlisted -> panic 4207
  Att->>SA: transfer to allowed recipient above per-call cap
  SA->>P: enforce -> panic 4206
  Att->>SA: many small transfers
  SA->>SL: window exceeded -> panic (observed 3221)
```

Worst-case loss = min(spending_limit window, per-call caps x calls) restricted to allowlisted contracts and recipients. Recovery: owner removes the session rule with the passkey.

## 6. x402 payment

### 6a. Self-hosted facilitator (settles on testnet)

```mermaid
sequenceDiagram
  participant A as Agent
  participant R as Resource server
  participant OP as Jev operator
  participant F as Self-hosted @x402/stellar 2.28.0 facilitator
  participant S as Soroban testnet
  A->>R: GET resource
  R-->>A: 402 + payment requirements
  A->>OP: decision for the payment auth entry
  OP-->>A: allow (p 0.95, 73 ms)
  A->>R: retry with PAYMENT-SIGNATURE
  R->>F: verify + settle (ceiling 500k stroops, policy-event allowance)
  F->>S: submit transfer (smart account __check_auth runs policies)
  S-->>F: success, tx 50466d23...fe4477
  R-->>A: 200 + resource
```

A one-time storage-rent prefund (`ExtendFootprintTTL`, tx `9bab6edd…`) keeps the warm payment under the ceiling. Details: [x402-settlement.md](x402-settlement.md).

### 6b. OZ hosted facilitator (still refused)

```mermaid
sequenceDiagram
  participant A as Agent
  participant F as OZ x402 facilitator (testnet)
  A->>F: verify(payload)
  F-->>A: invalid_exact_stellar_payload_fee_exceeds_maximum
  Note over A,F: fee 310k-5.73M stroops vs 50k ceiling; also rejects non-transfer policy events.
```

Upstream fix (policy-event allowance + smart-account fee profile) is a grant deliverable. Options are in [open-questions.md](open-questions.md).

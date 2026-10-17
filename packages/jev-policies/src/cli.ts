#!/usr/bin/env node
import { Command } from "commander";
import { Keypair } from "@stellar/stellar-sdk";
import { Chain, friendbot } from "./chain.js";
import { loadDeployments, loadState, saveState, STATE_PATH } from "./config.js";
import { createAccount, installSession, cosignedTransfer, DecisionDenied } from "./policies.js";
import { serve } from "./operator.js";
import { DEFAULT_MODEL, Intent } from "./jev.js";
import { intentHash } from "./encoding.js";

const d = loadDeployments();
const chain = new Chain(d);
const kp = (s?: string) => { if (!s) throw new Error(`missing key; run \`jev-policies init\` (state: ${STATE_PATH})`); return Keypair.fromSecret(s); };
const toStroops = (x: string) => BigInt(Math.round(Number(x) * 1e7));
const out = (o: unknown) => console.log(JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

const program = new Command().name("jev-policies").description("Stellar JEV Policies POC: Jev-cosigned OZ smart-account sessions").version("0.1.0");

program.command("init").description("generate local POC keys (fee payer, owner, agent, operator) and fund the fee payer on testnet")
  .action(async () => {
    const s = loadState();
    s.feePayerSecret ??= Keypair.random().secret(); s.ownerSecret ??= Keypair.random().secret();
    s.agentSecret ??= Keypair.random().secret(); s.operatorSecret ??= Keypair.random().secret();
    await friendbot(kp(s.feePayerSecret).publicKey());
    saveState(s);
    out({ state: STATE_PATH, feePayer: kp(s.feePayerSecret).publicKey(), owner: kp(s.ownerSecret).publicKey(), agent: kp(s.agentSecret).publicKey(), operator: kp(s.operatorSecret).publicKey() });
  });

program.command("account").description("deploy an OZ smart account owned by the owner key and fund it with XLM")
  .option("--fund <xlm>", "XLM to move into the account", "100")
  .action(async (o) => {
    const s = loadState();
    const r = await createAccount(chain, kp(s.feePayerSecret), kp(s.ownerSecret), Number(o.fund));
    s.account = r.account; saveState(s); out(r);
  });

program.command("install").description("install a Jev agent session: token-scoped rule with simple_threshold(2) + spending_limit + jev_policy")
  .option("--token <C...>", "SEP-41 token (default: native XLM SAC)", d.assets.native_xlm_sac)
  .requiredOption("--limit <amount>", "spending_limit per period (token units)")
  .option("--period <ledgers>", "rolling window in ledgers (17280 ~ 1 day)", "17280")
  .option("--allow <contract:fn...>", "allowlisted calls (default: <token>:transfer)")
  .option("--recipient <addr...>", "allowed recipients (empty = any)", [])
  .option("--max-per-call <amount>", "per-call cap (default: --limit)")
  .requiredOption("--threshold <p>", "calibrated p(allow) threshold, 0..1")
  .option("--model <id>", "pinned Jev model id", DEFAULT_MODEL)
  .option("--intent <text>", "human intent the user signs at grant time", "Pay approved vendors for small invoices")
  .option("--max-age <ledgers>", "max decision lifetime", "12")
  .action(async (o) => {
    const s = loadState();
    if (!s.account) throw new Error("no account; run `jev-policies account`");
    const allow = (o.allow ?? [`${o.token}:transfer`]).map((x: string) => { const [contract, fn] = x.split(":"); return { contract, fn }; });
    const maxPerCall = toStroops(o.maxPerCall ?? o.limit);
    const intent: Intent = { description: o.intent, asset: o.token, recipients: o.recipient, max_amount: maxPerCall.toString() };
    const key = { tauAllowPpm: Math.round(Number(o.threshold) * 1e6), templateId: 1, maxAgeLedgers: Number(o.maxAge), model: o.model };
    const r = await installSession(chain, kp(s.feePayerSecret), kp(s.ownerSecret), kp(s.agentSecret), kp(s.operatorSecret), {
      account: s.account, token: o.token, limit: toStroops(o.limit), periodLedgers: Number(o.period), allow,
      recipients: o.recipient, maxPerCall, intent, key,
    });
    s.ruleId = r.ruleId; s.intent = intent; s.key = key; saveState(s);
    out({ hash: r.hash, ruleId: r.ruleId, intentHash: intentHash(intent).toString("hex"), key });
  });

program.command("sign").alias("transfer").description("agent transfer from the smart account, co-signed by the Jev operator (2-of-2, one tx)")
  .requiredOption("--to <addr>").requiredOption("--amount <amount>")
  .option("--purpose <text>", "agent's claimed purpose (untrusted, length-capped)", "")
  .option("--operator-url <url>", "remote operator (default: in-process)", process.env.JEV_OPERATOR_URL)
  .option("--force", "submit even if Jev denies (to show the on-chain rejection)")
  .action(async (o) => {
    const s = loadState();
    if (!s.account || s.ruleId === undefined || !s.key) throw new Error("run `account` and `install` first");
    try {
      const r = await cosignedTransfer(chain, kp(s.feePayerSecret), kp(s.agentSecret), kp(s.operatorSecret), {
        account: s.account, ruleId: s.ruleId, token: s.intent.asset, to: o.to, amount: toStroops(o.amount), purpose: o.purpose,
        intent: s.intent, key: s.key, operatorUrl: o.operatorUrl, force: o.force,
      });
      out({ status: "submitted", hash: r.hash, jev: r.decision.jev, pAllowPpm: r.decision.pAllowPpm });
    } catch (e: any) {
      if (e instanceof DecisionDenied) { out({ status: "blocked-offchain", jev: e.decision.jev }); process.exitCode = 2; return; }
      out({ status: "rejected", error: String(e.message).slice(0, 600) }); process.exitCode = 1;
    }
  });

program.command("operator").description("run the Jev operator HTTP service (Jev if JEV_API_KEY is set, mock otherwise)")
  .option("--port <n>", "port", "8787")
  .action((o) => { serve(kp(loadState().operatorSecret), Number(o.port)); });

program.command("status").description("show the account, session rule and installed jev_policy params")
  .action(async () => {
    const s = loadState();
    const fp = kp(s.feePayerSecret);
    const res: any = { account: s.account, ruleId: s.ruleId, key: s.key, intent: s.intent, contracts: d.contracts };
    if (s.account && s.ruleId !== undefined) {
      const { addr, u32 } = await import("./scval.js");
      res.rule = await chain.view(fp, s.account, "get_context_rule", [u32(s.ruleId)]);
      res.spending = await chain.view(fp, d.contracts.oz_spending_limit, "get_spending_limit_data", [u32(s.ruleId), addr(s.account)]);
    }
    out(res);
  });

program.parseAsync().catch((e) => { console.error(e.message ?? e); process.exit(1); });

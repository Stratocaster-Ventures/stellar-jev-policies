import { Keypair, rpc, TransactionBuilder, Operation, xdr, BASE_FEE, Address, scValToNative, authorizeEntry } from "@stellar/stellar-sdk";
import type { Deployments } from "./config.js";
import { sorobanAuthPayload, contractAddressOf } from "./encoding.js";

export type AuthSigner = (entry: xdr.SorobanAuthorizationEntry, signaturePayload: Buffer, expiration: number) => Promise<xdr.ScVal>;

export class Chain {
  server: rpc.Server;
  constructor(public d: Deployments) { this.server = new rpc.Server(d.rpcUrl); }

  async latestLedger() { return (await this.server.getLatestLedger()).sequence; }

  private async build(source: Keypair, op: xdr.Operation) {
    const acct = await this.server.getAccount(source.publicKey());
    return new TransactionBuilder(acct, { fee: (Number(BASE_FEE) * 100).toString(), networkPassphrase: this.d.networkPassphrase })
      .addOperation(op).setTimeout(60).build();
  }

  /** Read-only simulation; returns native value. */
  async view(source: Keypair, contract: string, fn: string, args: xdr.ScVal[]) {
    const tx = await this.build(source, Operation.invokeContractFunction({ contract, function: fn, args }));
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
    return sim.result ? scValToNative(sim.result.retval) : undefined;
  }

  /**
   * Invoke with smart-account auth: simulate (recording), sign each auth entry whose
   * address is `account` via `signer`, re-simulate (enforcing, so __check_auth +
   * verifier/policy footprints are captured), then submit.
   */
  async invoke(source: Keypair, op: xdr.Operation, account?: string, signer?: AuthSigner) {
    let tx = await this.build(source, op);
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`simulate: ${sim.error}`);
    let finalOp = op;
    if (account && signer) {
      const latest = await this.latestLedger();
      const exp = latest + 12; // ~60s
      const auth: xdr.SorobanAuthorizationEntry[] = [];
      for (const e of sim.result?.auth ?? []) {
        if (contractAddressOf(e) === account) {
          const payload = sorobanAuthPayload(e, this.d.networkPassphrase, exp);
          const sig = await signer(e, payload, exp);
          auth.push(await authorizeEntry(e, async () => ({ signatureScVal: sig }), exp, this.d.networkPassphrase));
        } else auth.push(e);
      }
      const decoded: any = tx.operations[0];
      finalOp = Operation.invokeHostFunction({ func: decoded.func, auth });
      tx = await this.build(source, finalOp);
      const sim2 = await this.server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim2)) throw new Error(`simulate(enforcing): ${sim2.error}`);
      tx = rpc.assembleTransaction(tx, sim2).build();
    } else {
      tx = rpc.assembleTransaction(tx, sim).build();
    }
    tx.sign(source);
    const sent = await this.server.sendTransaction(tx);
    if (sent.status === "ERROR") throw new Error(`send: ${JSON.stringify(sent.errorResult?.toXDR("base64"))}`);
    const res = await this.server.pollTransaction(sent.hash, { attempts: 30 });
    if (res.status !== "SUCCESS") throw new Error(`tx ${sent.hash} ${res.status}`);
    const ret = (res as any).returnValue as xdr.ScVal | undefined;
    return { hash: sent.hash, ret: ret ? scValToNative(ret) : undefined };
  }

  async deployContract(source: Keypair, wasmHash: string, constructorArgs: xdr.ScVal[]) {
    const op = Operation.createCustomContract({
      address: new Address(source.publicKey()), wasmHash: Buffer.from(wasmHash, "hex"),
      salt: Keypair.random().rawPublicKey(), constructorArgs,
    });
    const r = await this.invoke(source, op);
    return { ...r, contractId: r.ret as string };
  }
}

export async function friendbot(pub: string) {
  const r = await fetch(`https://friendbot.stellar.org/?addr=${pub}`);
  if (!r.ok && r.status !== 400) throw new Error(`friendbot ${r.status}`);
}

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../..");

export interface Deployments {
  network: string; rpcUrl: string; networkPassphrase: string;
  contracts: Record<"jev_verifier" | "jev_policy" | "oz_ed25519_verifier" | "oz_simple_threshold" | "oz_spending_limit", string>;
  wasmHashes: { oz_smart_account: string };
  webauthn_verifier?: string; // OZ WebAuthn verifier (stateless; smart-account-kit testnet deployment)
  assets: { native_xlm_sac: string };
}
export function loadDeployments(): Deployments {
  const p = process.env.JEV_DEPLOYMENTS ?? join(REPO_ROOT, "deployments/testnet.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

/** Local POC keystore (gitignored). Production: passkey (owner), agent wallet, operator in TEE/KMS. */
export interface State {
  feePayerSecret?: string; ownerSecret?: string; agentSecret?: string; operatorSecret?: string;
  account?: string; ruleId?: number; intent?: any;
  key?: { tauAllowPpm: number; templateId: number; maxAgeLedgers: number; model: string };
}
export const STATE_PATH = process.env.JEV_STATE ?? join(process.cwd(), ".jev/state.json");
export function loadState(): State { return existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : {}; }
export function saveState(s: State) { mkdirSync(dirname(STATE_PATH), { recursive: true }); writeFileSync(STATE_PATH, JSON.stringify(s, null, 2), { mode: 0o600 }); }

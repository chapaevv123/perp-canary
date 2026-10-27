import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { decodeKnownLogs, BTC_POOL, OWNER_TRADING_WALLET, type RawReceipt } from './trade-forensics.ts';
import { MAX_GAS_COST_WEI, MAX_GAS_LIMIT, verifyPreparedPlan, type PreparedPlan } from './delegated-plan.ts';
import { verifyOrderActionPlan, type OrderActionPlan } from './order-actions.ts';
import { canonical, sha256 } from './evidence.ts';
import { parseUnits } from 'viem';
import type { ExecutionEntry } from './execution-ledger.ts';

export type ProofPlan = PreparedPlan | OrderActionPlan;
export type ProofClassification = 'PREPARED' | 'BLOCKED' | 'NOT_BROADCAST' |
  'BROADCAST_UNKNOWN' | 'ONCHAIN_SUCCESS' | 'ONCHAIN_REVERT' | 'INDETERMINATE';
export type ProofSnapshot = { chainId: number; transaction: { hash: string; from: string;
  to: string | null; input: string; value: string; nonce: number; gas: string;
  gasPrice: string | null; blockHash: string | null;
  blockNumber: string | null } | null; receipt: RawReceipt | null };
export type ProofRpc = { snapshot: (txHash: string) => Promise<ProofSnapshot> };
export type CanaryProofBundle = { schema: 'perp-canary/canary-proof/v1'; createdAt: string;
  plan: ProofPlan; planHash: string; chainId: 50383; market: 'BTC-PERP';
  pool: string; owner: string; bot: string;
  preflight: { observedAt: string; sampledBlock: string | null; expiresAt: string;
    bestBidRaw: string; bestAskRaw: string; markRaw: string; freshness: 'PLAN_RECORDED_ONLY' };
  risk: { maxNotionalWei: string | null; estimatedGasUnits: string; gasLimit: string;
    maxGasCostWei: string; actualGasUsed: string | null };
  simulation: { result: 'PLAN_RECORDED_ONLY' | 'UNKNOWN'; note: string };
  revalidation: { status: 'NOT_PERSISTED'; note: string };
  authorization: { method: 'LOCAL_CLI_EXACT_HASH'; secretStored: false;
    ledgerState: string | null; ledgerHeadHash: string | null };
  execution: { classification: ProofClassification; txHash: string | null;
    snapshot: ProofSnapshot | null }; hash: string };
export type ProofVerdict = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'FAILED' | 'INDETERMINATE';
export type ProofResult = { verdict: ProofVerdict; classification: ProofClassification;
  outcome: 'RESTED_AT_PLACEMENT' | 'FULL_FILL' | 'PARTIAL_FILL' | 'CANCELLED' | 'NO_FILL' | 'UNKNOWN';
  reasons: string[]; independentChainRead: boolean; planHash: string; txHash: string | null };

const same = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
const CANARY_BOT = '0xA8ad1E44f4D74EF1fCDf479A97D54e6Bdf6fBE36';
function verifyPlan(plan: ProofPlan): void {
  if (plan.schema === 'perp-canary/delegated-plan/v2') verifyPreparedPlan(plan);
  else if (plan.schema === 'perp-canary/order-action-plan/v1') verifyOrderActionPlan(plan);
  else throw Error('Unsupported proof plan schema');
}
export function validateCanaryProof(bundle: CanaryProofBundle): void {
  const { hash, ...body } = bundle ?? {} as CanaryProofBundle;
  if (!bundle || bundle.schema !== 'perp-canary/canary-proof/v1' || !bundle.plan ||
    hash !== sha256(body))
    throw Error('Canary proof schema or SHA-256 invalid');
  verifyPlan(bundle.plan);
  if (bundle.planHash !== bundle.plan.hash || bundle.chainId !== 50383 ||
    bundle.market !== 'BTC-PERP' || !same(bundle.pool, BTC_POOL) ||
    !same(bundle.owner, OWNER_TRADING_WALLET) || !same(bundle.bot, CANARY_BOT) ||
    !same(bundle.pool, bundle.plan.pool) ||
    !same(bundle.owner, bundle.plan.owner) || !same(bundle.bot, bundle.plan.operator) ||
    bundle.preflight.expiresAt !== bundle.plan.expiresAt ||
    bundle.authorization.method !== 'LOCAL_CLI_EXACT_HASH' || bundle.authorization.secretStored !== false ||
    (bundle.execution.txHash === null && bundle.execution.snapshot !== null) ||
    (bundle.execution.txHash !== null && !/^0x[0-9a-fA-F]{64}$/.test(bundle.execution.txHash)))
    throw Error('Canary proof identity or plan mismatch');
}
export function buildCanaryProof(plan: ProofPlan, ledger: ExecutionEntry[],
  snapshot: ProofSnapshot | null = null, now = new Date().toISOString()): CanaryProofBundle {
  verifyPlan(plan);
  if (ledger.some(row => row.planHash !== plan.hash || row.intentId !== plan.intentId))
    throw Error('Execution ledger does not belong to plan');
  const last = ledger.at(-1);
  const txHash = last?.txHash ?? null;
  if (txHash && snapshot?.transaction && !same(snapshot.transaction.hash, txHash))
    throw Error('Captured transaction hash differs from intent ledger');
  const classification: ProofClassification = !txHash ?
    last || Date.parse(now) >= Date.parse(plan.expiresAt) ? 'NOT_BROADCAST' :
      plan.status === 'PREPARED' ? 'PREPARED' : 'BLOCKED' :
    !snapshot?.receipt ? last?.state === 'BROADCAST_UNKNOWN' ? 'BROADCAST_UNKNOWN' : 'INDETERMINATE' :
      snapshot.receipt.status === '0x1' ? 'ONCHAIN_SUCCESS' : 'ONCHAIN_REVERT';
  const place = plan.schema === 'perp-canary/delegated-plan/v2' ? plan : null;
  const body = { schema: 'perp-canary/canary-proof/v1' as const, createdAt: now,
    plan, planHash: plan.hash, chainId: 50383 as const, market: 'BTC-PERP' as const,
    pool: plan.pool, owner: plan.owner, bot: plan.operator,
    preflight: { observedAt: plan.observedAt, sampledBlock: place?.sampledBlock ??
      (plan.schema === 'perp-canary/order-action-plan/v1' ? plan.before?.block ?? null : null),
      expiresAt: plan.expiresAt, bestBidRaw: place?.bookTops?.bestBidRaw ?? 'UNKNOWN',
      bestAskRaw: place?.bookTops?.bestAskRaw ?? 'UNKNOWN', markRaw: place?.markPriceRaw ?? 'UNKNOWN',
      freshness: 'PLAN_RECORDED_ONLY' as const },
    risk: { maxNotionalWei: place?.risk.maxNotionalWei ?? null,
      estimatedGasUnits: place?.risk.estimatedGasUnits ??
        (plan.schema === 'perp-canary/order-action-plan/v1' ? plan.risk.estimatedGas : 'UNKNOWN'),
      gasLimit: plan.risk.gasLimit, maxGasCostWei: plan.risk.maxGasCostWei,
      actualGasUsed: snapshot?.receipt?.gasUsed ?? null },
    simulation: { result: plan.checks.simulation ? 'PLAN_RECORDED_ONLY' as const : 'UNKNOWN' as const,
      note: 'Historical local estimate is recorded; this verifier does not independently attest it' },
    revalidation: { status: 'NOT_PERSISTED' as const,
      note: 'The CLI repeats preflight, but detailed recheck snapshots are not retained in this bundle' },
    authorization: { method: 'LOCAL_CLI_EXACT_HASH' as const, secretStored: false as const,
      ledgerState: last?.state ?? null, ledgerHeadHash: last?.hash ?? null },
    execution: { classification, txHash, snapshot } };
  return { ...body, hash: sha256(body) };
}
export function classifyCanaryEvents(plan: ProofPlan, receipt: RawReceipt): ProofResult['outcome'] {
  const { events } = decodeKnownLogs(receipt);
  if (plan.schema === 'perp-canary/order-action-plan/v1') {
    if (plan.operation !== 'CANCEL') return 'UNKNOWN';
    return events.some(event => event.eventName === 'OrderCancelled' && same(event.address, plan.pool) &&
      String(event.args.orderId) === plan.orderId) ? 'CANCELLED' : 'UNKNOWN';
  }
  const placed = events.find(event => event.eventName === 'OrderPlaced' && same(event.address, plan.pool) &&
    same((event.args.placedOrder as { owner?: string } | undefined)?.owner, plan.owner) &&
    String((event.args.placedOrder as { fullQuantity?: unknown } | undefined)?.fullQuantity) ===
      parseUnits(plan.quantity, 8).toString() &&
    String((event.args.placedOrder as { price?: unknown } | undefined)?.price) ===
      parseUnits(plan.price, 18).toString() &&
    (event.args.placedOrder as { isBid?: unknown } | undefined)?.isBid === (plan.side === 'BUY'));
  if (!placed) return 'UNKNOWN';
  const id = String(placed.args.orderId);
  const rested = events.some(event => event.eventName === 'OrderRested' && same(event.address, plan.pool) &&
    String(event.args.orderId) === id);
  const fills = events.filter(event => event.eventName === 'OrderFilled' && same(event.address, plan.pool) &&
    String(event.args.takerOrderId) === id);
  if (plan.executionMode === 'POST_ONLY') return rested && fills.length === 0 ? 'RESTED_AT_PLACEMENT' : 'UNKNOWN';
  let filled = 0n;
  for (const fill of fills) {
    const quantity = BigInt(String(fill.args.quantityFilled));
    const price = BigInt(String(fill.args.fillPrice));
    if (quantity <= 0n || (plan.side === 'BUY' ? price > parseUnits(plan.price, 18) :
      price < parseUnits(plan.price, 18))) return 'UNKNOWN';
    filled += quantity;
  }
  const expected = parseUnits(plan.quantity, 8);
  if (filled > expected) return 'UNKNOWN';
  if (filled > 0n) {
    const after = BigInt(plan.positionSizeBeforeRaw) + (plan.side === 'BUY' ? filled : -filled);
    if (!events.some(event => event.eventName === 'PositionUpdated' &&
      same(event.args.account as string, plan.owner) && same(event.args.perpPool as string, plan.pool) &&
      String(event.args.newSize) === after.toString())) return 'UNKNOWN';
  }
  return filled === expected ? 'FULL_FILL' : filled > 0n && filled < expected ? 'PARTIAL_FILL' : 'NO_FILL';
}
export async function verifyCanaryProof(bundle: CanaryProofBundle, rpc: ProofRpc): Promise<ProofResult> {
  try { validateCanaryProof(bundle); }
  catch (error) { return { verdict: 'FAILED', classification: 'INDETERMINATE', outcome: 'UNKNOWN',
    reasons: [error instanceof Error ? error.message : 'Invalid bundle'], independentChainRead: false,
    planHash: bundle?.planHash ?? 'UNKNOWN', txHash: bundle?.execution?.txHash ?? null }; }
  const base = { planHash: bundle.planHash, txHash: bundle.execution.txHash };
  if (!bundle.execution.txHash) return { ...base, verdict: 'PARTIALLY_VERIFIED',
    classification: bundle.execution.classification, outcome: 'UNKNOWN', independentChainRead: false,
    reasons: ['Plan integrity verified locally; no transaction hash or independent on-chain execution evidence'] };
  let live: ProofSnapshot;
  try { live = await rpc.snapshot(bundle.execution.txHash); }
  catch { return { ...base, verdict: 'INDETERMINATE', classification: 'INDETERMINATE', outcome: 'UNKNOWN',
    independentChainRead: false, reasons: ['Independent RPC read unavailable'] }; }
  if (live.chainId !== 50383) return { ...base, verdict: 'FAILED', classification: 'INDETERMINATE',
    outcome: 'UNKNOWN', independentChainRead: true, reasons: ['RPC chain ID mismatch'] };
  if (!live.transaction || !live.receipt) return { ...base, verdict: 'INDETERMINATE',
    classification: 'INDETERMINATE', outcome: 'UNKNOWN', independentChainRead: true,
    reasons: ['Transaction or receipt absent on verified chain'] };
  const tx = live.transaction; const receipt = live.receipt;
  const expectedInput = bundle.plan.transaction?.data;
  const gasCost = receipt.effectiveGasPrice ? BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice) : null;
  if (!same(tx.hash, bundle.execution.txHash) || !same(receipt.transactionHash, tx.hash) ||
    !same(tx.from, bundle.bot) || !same(tx.to, bundle.pool) || !same(receipt.from, tx.from) ||
    !same(receipt.to, tx.to) || tx.input !== expectedInput || tx.value !== '0' ||
    BigInt(tx.gas) > BigInt(bundle.plan.risk.gasLimit) || BigInt(tx.gas) > MAX_GAS_LIMIT ||
    tx.gasPrice === null || BigInt(tx.gas) * BigInt(tx.gasPrice) > MAX_GAS_COST_WEI ||
    gasCost === null || gasCost > MAX_GAS_COST_WEI ||
    receipt.logs.some(log => !same(log.transactionHash, tx.hash) || log.removed === true) ||
    !same(tx.blockHash, receipt.blockHash) || tx.blockNumber !== receipt.blockNumber ||
    (bundle.execution.snapshot && sha256(bundle.execution.snapshot) !== sha256(live)))
    return { ...base, verdict: 'FAILED', classification: 'INDETERMINATE', outcome: 'UNKNOWN',
      independentChainRead: true, reasons: ['Independent transaction, receipt, or stored snapshot differs from approved plan'] };
  if (receipt.status !== '0x1') return { ...base, verdict: 'VERIFIED',
    classification: 'ONCHAIN_REVERT', outcome: 'UNKNOWN', independentChainRead: true,
    reasons: ['Matching transaction was mined but reverted; no order success or fill'] };
  let outcome: ProofResult['outcome'];
  try { outcome = classifyCanaryEvents(bundle.plan, receipt); }
  catch { outcome = 'UNKNOWN'; }
  if (outcome === 'UNKNOWN' || outcome === 'NO_FILL') return { ...base, verdict: 'PARTIALLY_VERIFIED',
    classification: 'ONCHAIN_SUCCESS', outcome, independentChainRead: true,
    reasons: ['Receipt succeeded but required order events or state are insufficient for an execution claim'] };
  return { ...base, verdict: 'VERIFIED', classification: 'ONCHAIN_SUCCESS', outcome,
    independentChainRead: true, reasons: ['Approved transaction and official order events match independent chain data'] };
}
export async function saveCanaryProof(dir: string, bundle: CanaryProofBundle): Promise<string> {
  validateCanaryProof(bundle);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `canary-proof-${Date.parse(bundle.createdAt)}-${bundle.hash.slice(0, 12)}.json`);
  await writeFile(path, `${canonical(bundle)}\n`, { flag: 'wx' });
  return path;
}
export async function readCanaryProof(path: string): Promise<CanaryProofBundle> {
  if (!/^canary-proof-\d{13}-[0-9a-f]{12}\.json$/.test(basename(path)))
    throw Error('Invalid Canary proof filename');
  const bundle = JSON.parse(await readFile(path, 'utf8')) as CanaryProofBundle;
  validateCanaryProof(bundle);
  return bundle;
}

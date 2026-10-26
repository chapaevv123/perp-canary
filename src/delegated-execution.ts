import { keccak256, type Hex, type TransactionSerializable } from 'viem';
import { MAX_GAS_COST_WEI, MAX_GAS_LIMIT, validatePlaceCall, verifyPreparedPlan, type PreparedPlan } from './delegated-plan.ts';
import type { inspectTradingAuthorization } from './trading-authorization.ts';
import { appendExecutionState, reserveIntent } from './execution-ledger.ts';
import { assessDelegatedTrade, saveForensicEvidence } from './delegated-forensics.ts';
import type { ForensicsBody } from './trade-forensics.ts';

type Observation = Awaited<ReturnType<typeof inspectTradingAuthorization>>;
export type ExecutionPorts = { fresh: () => Promise<Observation>; chainId: () => Promise<number>;
  nonce: (tag: 'latest' | 'pending') => Promise<number>; gasPrice: () => Promise<bigint>;
  gasBalance: () => Promise<bigint>; estimateOriginal: (plan: PreparedPlan) => Promise<bigint>;
  confirm: (plan: PreparedPlan) => Promise<boolean>;
  sign: (transaction: TransactionSerializable, expectedAddress: string) => Promise<Hex>;
  verifySigned: (raw: Hex, expected: TransactionSerializable, operator: string) => Promise<boolean>;
  broadcastOnce: (raw: Hex) => Promise<Hex>;
  receiptAndForensics: (txHash: Hex) => Promise<{ body: ForensicsBody; currentPositionRaw: string | null } | null> };
export type PreflightState = { passed: boolean; blockers: string[]; nonce: number;
  gasPriceWei: string; gasBalanceWei: string; simulatedGas: string };
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function assessExecutionPreflight(plan: PreparedPlan, fresh: Observation, input: {
  chainId: number; latestNonce: number; pendingNonce: number; gasPrice: bigint; gasBalance: bigint;
  simulatedGas: bigint; now: number }): PreflightState {
  verifyPreparedPlan(plan);
  const blockers: string[] = [];
  if (plan.status !== 'PREPARED' || Object.values(plan.checks).some(value => !value)) blockers.push('Saved plan was not prepared');
  if (input.chainId !== 50383) blockers.push('Wrong chain ID');
  if (input.now >= Date.parse(plan.expiresAt) || input.now < Date.parse(plan.observedAt)) blockers.push('Plan expired or clock invalid');
  if (input.now - Date.parse(fresh.observedAt) > 30_000 || Date.parse(fresh.observedAt) > input.now)
    blockers.push('Fresh preflight stale');
  if (fresh.chainId !== 50383 || fresh.market !== 'BTC-PERP' || !same(fresh.pool, plan.pool) ||
    !same(fresh.tradingWallet, plan.owner) || !same(fresh.candidateOperator, plan.operator) ||
    fresh.marketSupported.status !== 'SUPPORTED') blockers.push('Market or address mismatch');
  if (fresh.registryMatches.status !== 'SUPPORTED' || fresh.permissions.place.effective.status !== 'SUPPORTED')
    blockers.push('Bot permission revoked or unknown');
  if (fresh.marginSufficient !== true || fresh.unsigned === null || fresh.planBlockers.length)
    blockers.push('Margin, size, precision or SDK preflight failed');
  if (fresh.unsigned && (fresh.unsigned.chainId !== 50383 || !same(fresh.unsigned.to, plan.pool) ||
    !same(fresh.unsigned.from, plan.operator) || fresh.unsigned.value !== '0' ||
    !validatePlaceCall(fresh.unsigned.data, { owner: plan.owner, side: plan.side, price: plan.price,
      quantity: plan.quantity, expiresAt: fresh.unsigned.expiresAt })))
    blockers.push('Fresh calldata mismatch');
  if (fresh.simulation.status !== 'SUPPORTED') blockers.push('Fresh simulation failed');
  if (fresh.positionSizeRaw !== plan.positionSizeBeforeRaw) blockers.push('Position changed since plan');
  try {
    const then = BigInt(plan.markPriceRaw);
    const current = BigInt(fresh.markPriceRaw);
    if (then <= 0n || current <= 0n || (current > then ? current - then : then - current) * 100n > then)
      blockers.push('Market mark moved more than 1%');
  } catch { blockers.push('Market mark unavailable'); }
  if (!Number.isSafeInteger(input.latestNonce) || !Number.isSafeInteger(input.pendingNonce) ||
    input.latestNonce !== input.pendingNonce) blockers.push('Nonce pending or invalid');
  const gasLimit = BigInt(plan.risk.gasLimit);
  if (gasLimit <= 0n || gasLimit > MAX_GAS_LIMIT || input.simulatedGas <= 0n || input.simulatedGas > gasLimit)
    blockers.push('Original calldata simulation exceeds gas limit');
  const gasCost = gasLimit * input.gasPrice;
  if (input.gasPrice <= 0n || gasCost > MAX_GAS_COST_WEI ||
    gasCost > BigInt(plan.risk.maxGasCostWei) || input.gasBalance < gasCost)
    blockers.push('Gas budget or balance failed');
  return { passed: blockers.length === 0, blockers, nonce: input.pendingNonce,
    gasPriceWei: input.gasPrice.toString(), gasBalanceWei: input.gasBalance.toString(),
    simulatedGas: input.simulatedGas.toString() };
}
export type ExecutionOutcome = { state: 'CANCELLED' | 'BLOCKED' | 'UNKNOWN' | 'VERIFIED' | 'AMBER' | 'RED';
  planHash: string; txHash: string | null; reasons: string[]; forensicHash?: string };
export async function executeDelegatedPlan(plan: PreparedPlan, ports: ExecutionPorts,
  dirs: { ledger: string; forensics: string }): Promise<ExecutionOutcome> {
  verifyPreparedPlan(plan);
  const base = { planHash: plan.hash, txHash: null as string | null };
  if (plan.status !== 'PREPARED') return { ...base, state: 'BLOCKED', reasons: plan.blockers };
  if (Date.now() >= Date.parse(plan.expiresAt)) return { ...base, state: 'BLOCKED', reasons: ['Plan expired'] };
  const first = await gatherPreflight(plan, ports);
  if (!first.passed) return { ...base, state: 'BLOCKED', reasons: first.blockers };
  if (!await ports.confirm(plan)) return { ...base, state: 'CANCELLED', reasons: ['Owner did not confirm exact plan hash'] };
  const second = await gatherPreflight(plan, ports);
  if (!second.passed || second.nonce !== first.nonce) return { ...base, state: 'BLOCKED',
    reasons: [...second.blockers, ...(second.nonce !== first.nonce ? ['Nonce changed before signing'] : [])] };
  await reserveIntent(dirs.ledger, plan.intentId, plan.hash);
  const transaction: TransactionSerializable = { type: 'legacy', chainId: 50383,
    to: plan.pool as `0x${string}`, data: plan.transaction!.data, value: 0n,
    gas: BigInt(plan.risk.gasLimit), gasPrice: BigInt(second.gasPriceWei), nonce: second.nonce };
  let raw: Hex;
  try { raw = await ports.sign(transaction, plan.operator); }
  catch { return { ...base, state: 'BLOCKED', reasons: ['Local signing failed; intent remains reserved'] }; }
  if (!await ports.verifySigned(raw, transaction, plan.operator))
    return { ...base, state: 'BLOCKED', reasons: ['Signed transaction does not match exact plan; intent remains reserved'] };
  const signedHash = keccak256(raw);
  await appendExecutionState(dirs.ledger, plan.intentId, plan.hash, 'SIGNED', signedHash);
  let submitted: Hex;
  try { submitted = await ports.broadcastOnce(raw); }
  catch {
    await appendExecutionState(dirs.ledger, plan.intentId, plan.hash, 'BROADCAST_UNKNOWN', signedHash);
    return { ...base, state: 'UNKNOWN', txHash: signedHash, reasons: ['Broadcast outcome unknown; manually reconcile, never retry automatically'] };
  }
  if (!same(submitted, signedHash)) {
    await appendExecutionState(dirs.ledger, plan.intentId, plan.hash, 'BROADCAST_UNKNOWN', signedHash);
    return { ...base, state: 'UNKNOWN', txHash: signedHash, reasons: ['RPC returned a different hash; manually reconcile'] };
  }
  await appendExecutionState(dirs.ledger, plan.intentId, plan.hash, 'BROADCAST_ACCEPTED', signedHash);
  let evidence: Awaited<ReturnType<ExecutionPorts['receiptAndForensics']>>;
  try { evidence = await ports.receiptAndForensics(submitted); }
  catch { evidence = null; }
  if (!evidence) return { ...base, state: 'UNKNOWN', txHash: signedHash,
    reasons: ['Receipt or forensic read unavailable; manually reconcile'] };
  const forensic = assessDelegatedTrade(plan, evidence.body, evidence.currentPositionRaw);
  await saveForensicEvidence(dirs.forensics, forensic);
  await appendExecutionState(dirs.ledger, plan.intentId, plan.hash, forensic.verdict, signedHash);
  return { ...base, state: forensic.verdict, txHash: signedHash, reasons: forensic.reasons, forensicHash: forensic.hash };
}
async function gatherPreflight(plan: PreparedPlan, ports: ExecutionPorts): Promise<PreflightState> {
  const fresh = await ports.fresh();
  const [chainId, latestNonce, pendingNonce, gasPrice, gasBalance, simulatedGas] = await Promise.all([
    ports.chainId(), ports.nonce('latest'), ports.nonce('pending'), ports.gasPrice(), ports.gasBalance(),
    ports.estimateOriginal(plan),
  ]);
  return assessExecutionPreflight(plan, fresh, { chainId, latestNonce, pendingNonce, gasPrice,
    gasBalance, simulatedGas, now: Date.now() });
}

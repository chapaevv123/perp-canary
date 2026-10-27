import { keccak256, type Hex, type TransactionSerializable } from 'viem';
import { MAX_GAS_COST_WEI, MAX_GAS_LIMIT, validatePlaceCall, verifyPreparedPlan, type PreparedPlan } from './delegated-plan.ts';
import type { inspectTradingAuthorization } from './trading-authorization.ts';
import { appendExecutionState, reserveIntent } from './execution-ledger.ts';
import { assessDelegatedTrade, saveForensicEvidence } from './delegated-forensics.ts';
import type { ForensicsBody } from './trade-forensics.ts';
import type { ExecutionStage } from './execution-error-decoder.ts';
import { parseUnits } from 'viem';

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
  gasPriceWei: string; gasBalanceWei: string; simulatedGas: string;
  marketComparison: { bestBidAtPlanRaw: string; bestAskAtPlanRaw: string;
    bestBidNowRaw: string; bestAskNowRaw: string; markAtPlanRaw: string;
    markNowRaw: string; markDeviationBps: string | null; orderNotionalWei: string;
    unlockedMarginNow: string; estimatedGasUnits: string } };
export class ExecutionStageError extends Error {
  readonly stage: ExecutionStage;
  readonly original: unknown;
  readonly observation?: Observation;
  constructor(stage: ExecutionStage, original: unknown, observation?: Observation) {
    super(`Read-only execution check failed at ${stage}`);
    this.name = 'ExecutionStageError';
    this.stage = stage;
    this.original = original;
    this.observation = observation;
  }
}
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
  if (plan.rpcUrl && fresh.rpcUrl !== plan.rpcUrl) blockers.push('RPC endpoint changed since plan');
  if (fresh.registryMatches.status !== 'SUPPORTED' || fresh.permissions.place.effective.status !== 'SUPPORTED')
    blockers.push('Bot permission revoked or unknown');
  if (fresh.marginSufficient !== true || fresh.unsigned === null || fresh.planBlockers.length)
    blockers.push('Margin, size, precision or SDK preflight failed');
  if (fresh.unsigned && (fresh.unsigned.chainId !== 50383 || !same(fresh.unsigned.to, plan.pool) ||
    !same(fresh.unsigned.from, plan.operator) || fresh.unsigned.value !== '0' ||
    !validatePlaceCall(fresh.unsigned.data, { owner: plan.owner, side: plan.side, price: plan.price,
      quantity: plan.quantity, expiresAt: fresh.unsigned.expiresAt, executionMode: plan.executionMode })))
    blockers.push('Fresh calldata mismatch');
  const freshFailure = fresh.simulationFailure as { contractError: string | null; category: string } | null;
  if (fresh.simulation.status !== 'SUPPORTED')
    blockers.push(`Fresh simulation failed: ${freshFailure?.contractError ?? freshFailure?.category ?? 'UNKNOWN'}`);
  if (fresh.positionSizeRaw !== plan.positionSizeBeforeRaw) blockers.push('Position changed since plan');
  try {
    const then = BigInt(plan.markPriceRaw);
    const current = BigInt(fresh.markPriceRaw);
    if (then <= 0n || current <= 0n || (current > then ? current - then : then - current) * 100n > then)
      blockers.push('Market mark moved more than 1%');
  } catch { blockers.push('Market mark unavailable'); }
  try {
    const top = fresh.bookTops;
    if (plan.executionMode === 'POST_ONLY') {
      if (!top || top.blockNumber !== fresh.sampledBlock ||
        top.bestBidRaw === 'UNKNOWN' || top.bestAskRaw === 'UNKNOWN')
        blockers.push('PostOnly book snapshot unavailable or stale');
      else if (plan.side === 'BUY' ? parseUnits(plan.price, 18) >= BigInt(top.bestAskRaw) :
        parseUnits(plan.price, 18) <= BigInt(top.bestBidRaw)) blockers.push('PostOnly would cross current book');
    } else {
      if (top && top.bestAskRaw !== 'UNKNOWN' && plan.side === 'BUY' &&
        parseUnits(plan.price, 18) < BigInt(top.bestAskRaw)) blockers.push('BUY limit below current best ask');
      if (top && top.bestBidRaw !== 'UNKNOWN' && plan.side === 'SELL' &&
        parseUnits(plan.price, 18) > BigInt(top.bestBidRaw)) blockers.push('SELL limit above current best bid');
    }
  } catch { blockers.push('Current book top invalid'); }
  if (!Number.isSafeInteger(input.latestNonce) || !Number.isSafeInteger(input.pendingNonce) ||
    input.latestNonce !== input.pendingNonce) blockers.push('Nonce pending or invalid');
  const gasLimit = BigInt(plan.risk.gasLimit);
  if (gasLimit <= 0n || gasLimit > MAX_GAS_LIMIT || input.simulatedGas <= 0n || input.simulatedGas > gasLimit)
    blockers.push('Original calldata simulation exceeds gas limit');
  const gasCost = gasLimit * input.gasPrice;
  if (input.gasPrice <= 0n || gasCost > MAX_GAS_COST_WEI ||
    gasCost > BigInt(plan.risk.maxGasCostWei) || input.gasBalance < gasCost)
    blockers.push('Gas budget or balance failed');
  let markDeviationBps: string | null = null;
  try {
    const before = BigInt(plan.markPriceRaw);
    const now = BigInt(fresh.markPriceRaw);
    if (before > 0n && now > 0n)
      markDeviationBps = ((now > before ? now - before : before - now) * 10_000n / before).toString();
  } catch { /* UNKNOWN remains null. */ }
  return { passed: blockers.length === 0, blockers, nonce: input.pendingNonce,
    gasPriceWei: input.gasPrice.toString(), gasBalanceWei: input.gasBalance.toString(),
    simulatedGas: input.simulatedGas.toString(), marketComparison: {
      bestBidAtPlanRaw: plan.bookTops?.bestBidRaw ?? 'UNKNOWN',
      bestAskAtPlanRaw: plan.bookTops?.bestAskRaw ?? 'UNKNOWN',
      bestBidNowRaw: fresh.bookTops?.bestBidRaw ?? 'UNKNOWN',
      bestAskNowRaw: fresh.bookTops?.bestAskRaw ?? 'UNKNOWN',
      markAtPlanRaw: plan.markPriceRaw, markNowRaw: fresh.markPriceRaw,
      markDeviationBps, orderNotionalWei: plan.risk.orderNotionalWei,
      unlockedMarginNow: fresh.marginBankUnlocked,
      estimatedGasUnits: input.simulatedGas.toString(),
    } };
}
export type ExecutionOutcome = { state: 'CANCELLED' | 'BLOCKED' | 'UNKNOWN' | 'VERIFIED' | 'AMBER' | 'RED';
  planHash: string; txHash: string | null; reasons: string[]; forensicHash?: string };
export async function dispatchApprovedTransaction(input: { planHash: string; intentId: string;
  operator: string; pool: string; data: Hex; gasLimit: string; gasPriceWei: string; nonce: number },
  ports: Pick<ExecutionPorts, 'sign' | 'verifySigned' | 'broadcastOnce'>,
  ledger: string, finish: (txHash: Hex) => Promise<{ verdict: 'VERIFIED' | 'AMBER' | 'RED';
    reasons: string[]; hash: string } | null>): Promise<ExecutionOutcome> {
  const base = { planHash: input.planHash, txHash: null as string | null };
  await reserveIntent(ledger, input.intentId, input.planHash);
  const transaction: TransactionSerializable = { type: 'legacy', chainId: 50383,
    to: input.pool as `0x${string}`, data: input.data, value: 0n,
    gas: BigInt(input.gasLimit), gasPrice: BigInt(input.gasPriceWei), nonce: input.nonce };
  let raw: Hex;
  try { raw = await ports.sign(transaction, input.operator); }
  catch (error) {
    await appendExecutionState(ledger, input.intentId, input.planHash, 'BLOCKED_PRE_BROADCAST', null);
    if (error instanceof ExecutionStageError) throw error;
    return { ...base, state: 'BLOCKED', reasons: ['Local signing failed; no transaction was broadcast'] };
  }
  let signedMatches = false;
  try { signedMatches = await ports.verifySigned(raw, transaction, input.operator); }
  catch { /* Verification failure is pre-broadcast and terminal. */ }
  if (!signedMatches) {
    await appendExecutionState(ledger, input.intentId, input.planHash, 'BLOCKED_PRE_BROADCAST', null);
    return { ...base, state: 'BLOCKED', reasons: ['Signed transaction differs from approved plan; no broadcast'] };
  }
  const signedHash = keccak256(raw);
  await appendExecutionState(ledger, input.intentId, input.planHash, 'SIGNED', signedHash);
  let submitted: Hex;
  try { submitted = await ports.broadcastOnce(raw); }
  catch {
    await appendExecutionState(ledger, input.intentId, input.planHash, 'BROADCAST_UNKNOWN', signedHash);
    return { ...base, state: 'UNKNOWN', txHash: signedHash,
      reasons: ['Broadcast outcome unknown; manually reconcile, never retry automatically'] };
  }
  if (!same(submitted, signedHash)) {
    await appendExecutionState(ledger, input.intentId, input.planHash, 'BROADCAST_UNKNOWN', signedHash);
    return { ...base, state: 'UNKNOWN', txHash: signedHash, reasons: ['RPC returned a different hash; manually reconcile'] };
  }
  await appendExecutionState(ledger, input.intentId, input.planHash, 'BROADCAST_ACCEPTED', signedHash);
  let result: Awaited<ReturnType<typeof finish>>;
  try { result = await finish(submitted); } catch { result = null; }
  if (!result) return { ...base, state: 'UNKNOWN', txHash: signedHash,
    reasons: ['Receipt or forensic read unavailable; manually reconcile'] };
  await appendExecutionState(ledger, input.intentId, input.planHash, result.verdict, signedHash);
  return { ...base, state: result.verdict, txHash: signedHash,
    reasons: result.reasons, forensicHash: result.hash };
}
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
  return dispatchApprovedTransaction({ planHash: plan.hash, intentId: plan.intentId,
    operator: plan.operator, pool: plan.pool, data: plan.transaction!.data,
    gasLimit: plan.risk.gasLimit, gasPriceWei: second.gasPriceWei, nonce: second.nonce },
  ports, dirs.ledger, async txHash => {
    const evidence = await ports.receiptAndForensics(txHash);
    if (!evidence) return null;
    const forensic = assessDelegatedTrade(plan, evidence.body, evidence.currentPositionRaw);
    await saveForensicEvidence(dirs.forensics, forensic);
    return { verdict: forensic.verdict, reasons: forensic.reasons, hash: forensic.hash };
  });
}
export type ReadOnlyExecutionPorts = Pick<ExecutionPorts, 'fresh' | 'chainId' | 'nonce' |
  'gasPrice' | 'gasBalance' | 'estimateOriginal'>;
export async function checkDelegatedPlan(plan: PreparedPlan, ports: ReadOnlyExecutionPorts): Promise<PreflightState> {
  verifyPreparedPlan(plan);
  if (plan.status !== 'PREPARED' || Date.now() >= Date.parse(plan.expiresAt))
    throw new ExecutionStageError('PREFLIGHT', Error('Plan expired or not PREPARED'));
  return gatherPreflight(plan, ports);
}
async function gatherPreflight(plan: PreparedPlan, ports: ReadOnlyExecutionPorts): Promise<PreflightState> {
  let fresh: Observation;
  try { fresh = await ports.fresh(); }
  catch (error) { throw new ExecutionStageError('FRESH_STATE', error); }
  const tasks = [ports.chainId(), ports.nonce('latest'), ports.nonce('pending'),
    ports.gasPrice(), ports.gasBalance(), ports.estimateOriginal(plan)] as const;
  const stages: ExecutionStage[] = ['CHAIN', 'NONCE', 'NONCE', 'GAS_PRICE', 'GAS_BALANCE', 'ESTIMATE_GAS'];
  const results = await Promise.allSettled(tasks);
  for (const [index, result] of results.entries())
    if (result.status === 'rejected') throw new ExecutionStageError(stages[index]!, result.reason, fresh);
  const [chainId, latestNonce, pendingNonce, gasPrice, gasBalance, simulatedGas] =
    results.map(result => (result as PromiseFulfilledResult<unknown>).value) as
      [number, number, number, bigint, bigint, bigint];
  try { return assessExecutionPreflight(plan, fresh, { chainId, latestNonce, pendingNonce, gasPrice,
    gasBalance, simulatedGas, now: Date.now() }); }
  catch (error) { throw new ExecutionStageError('PREFLIGHT', error, fresh); }
}

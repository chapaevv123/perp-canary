import type { Hex } from 'viem';
import { dispatchApprovedTransaction, type ExecutionOutcome, type ExecutionPorts } from './delegated-execution.ts';
import { MAX_GAS_COST_WEI, MAX_GAS_LIMIT } from './delegated-plan.ts';
import { orderActionData, verifyOrderActionPlan,
  type OrderActionObservation, type OrderActionPlan } from './order-actions.ts';
import { assessOrderAction, saveOrderActionForensic } from './order-action-forensics.ts';
import type { ForensicsBody } from './trade-forensics.ts';

export type OrderActionPorts = Pick<ExecutionPorts, 'chainId' | 'nonce' | 'gasPrice' |
  'gasBalance' | 'sign' | 'verifySigned' | 'broadcastOnce'> & {
    fresh: () => Promise<OrderActionObservation>; estimateOriginal: () => Promise<bigint>;
    confirm: (plan: OrderActionPlan) => Promise<boolean>;
    receiptAndForensics: (txHash: Hex) => Promise<{ source: ForensicsBody;
      after: OrderActionObservation['snapshot'] } | null> };
export function assessOrderActionPreflight(plan: OrderActionPlan, fresh: OrderActionObservation,
  input: { chainId: number; latestNonce: number; pendingNonce: number; gasPrice: bigint;
    gasBalance: bigint; simulatedGas: bigint; now: number }) {
  verifyOrderActionPlan(plan);
  const blockers: string[] = [];
  if (plan.status !== 'PREPARED') blockers.push('Plan was not prepared');
  if (input.chainId !== 50383 || fresh.chainId !== 50383) blockers.push('Wrong chain');
  if (input.now >= Date.parse(plan.expiresAt) || input.now - Date.parse(fresh.observedAt) > 30_000 ||
    Date.parse(fresh.observedAt) > input.now) blockers.push('Expired plan or stale preflight');
  const before = plan.before;
  const current = fresh.snapshot;
  if (!before || !current || current.id !== plan.orderId || !current.active ||
    current.owner.toLowerCase() !== plan.owner.toLowerCase() ||
    current.pool.toLowerCase() !== plan.pool.toLowerCase() ||
    current.remainingRaw !== before.remainingRaw || current.fullRaw !== before.fullRaw ||
    current.priceRaw !== before.priceRaw || current.side !== before.side ||
    current.expiryNs !== before.expiryNs ||
    current.positionRaw !== before.positionRaw)
    blockers.push('Order ownership, state, remaining quantity or position changed');
  if (plan.operation === 'REDUCE_ORDER' && current && current.expiryNs !== '0' &&
    BigInt(current.expiryNs) <= BigInt(fresh.nowSeconds) * 1_000_000_000n)
    blockers.push('Resting order expired; reduceOrderFor is no longer allowed');
  if (fresh.permission !== 'SUPPORTED' || fresh.market !== 'SUPPORTED')
    blockers.push('Permission revoked or market unavailable');
  if (fresh.simulationFailure || fresh.estimatedGas === null)
    blockers.push('Current order action simulation failed');
  if (!plan.transaction || plan.transaction.data !== orderActionData(plan.operation, plan.owner,
    plan.orderId, plan.newRemainingRaw)) blockers.push('Calldata mismatch');
  if (!Number.isSafeInteger(input.latestNonce) || input.latestNonce !== input.pendingNonce)
    blockers.push('Nonce conflict');
  const limit = BigInt(plan.risk.gasLimit);
  const cost = limit * input.gasPrice;
  if (limit <= 0n || limit > MAX_GAS_LIMIT || input.simulatedGas <= 0n ||
    input.simulatedGas > limit || input.gasPrice <= 0n || cost > MAX_GAS_COST_WEI ||
    cost > BigInt(plan.risk.maxGasCostWei) || input.gasBalance < cost)
    blockers.push('Gas or exact calldata simulation failed');
  return { passed: blockers.length === 0, blockers, nonce: input.pendingNonce,
    gasPriceWei: input.gasPrice.toString() };
}
async function gather(plan: OrderActionPlan, ports: OrderActionPorts) {
  const fresh = await ports.fresh();
  const [chainId, latestNonce, pendingNonce, gasPrice, gasBalance, simulatedGas] = await Promise.all([
    ports.chainId(), ports.nonce('latest'), ports.nonce('pending'), ports.gasPrice(),
    ports.gasBalance(), ports.estimateOriginal(),
  ]);
  return assessOrderActionPreflight(plan, fresh, { chainId, latestNonce, pendingNonce,
    gasPrice, gasBalance, simulatedGas, now: Date.now() });
}
export async function executeOrderActionPlan(plan: OrderActionPlan, ports: OrderActionPorts,
  dirs: { ledger: string; forensics: string }): Promise<ExecutionOutcome> {
  verifyOrderActionPlan(plan);
  const base = { planHash: plan.hash, txHash: null };
  if (plan.status !== 'PREPARED' || Date.now() >= Date.parse(plan.expiresAt))
    return { ...base, state: 'BLOCKED', reasons: ['Plan blocked or expired'] };
  const first = await gather(plan, ports);
  if (!first.passed) return { ...base, state: 'BLOCKED', reasons: first.blockers };
  if (!await ports.confirm(plan)) return { ...base, state: 'CANCELLED', reasons: ['Owner declined exact operation and plan hash'] };
  const second = await gather(plan, ports);
  if (!second.passed || second.nonce !== first.nonce) return { ...base, state: 'BLOCKED',
    reasons: [...second.blockers, ...(second.nonce !== first.nonce ? ['Nonce changed'] : [])] };
  return dispatchApprovedTransaction({ planHash: plan.hash, intentId: plan.intentId,
    operator: plan.operator, pool: plan.pool, data: plan.transaction!.data,
    gasLimit: plan.risk.gasLimit, gasPriceWei: second.gasPriceWei, nonce: second.nonce },
  ports, dirs.ledger, async txHash => {
    const observed = await ports.receiptAndForensics(txHash);
    if (!observed) return null;
    const record = assessOrderAction(plan, observed.source, observed.after);
    await saveOrderActionForensic(dirs.forensics, record);
    return { verdict: record.verdict, reasons: record.reasons, hash: record.hash };
  });
}

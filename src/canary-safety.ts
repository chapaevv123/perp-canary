export type CanarySignal = 'STALE_MARKET' | 'IOC_NO_FILL' | 'PRICE_DEVIATION' |
  'INSUFFICIENT_MARGIN' | 'INSUFFICIENT_GAS' | 'REVOKED_PERMISSION' | 'WRONG_CHAIN' |
  'FOREIGN_ORDER' | 'DUPLICATE_INTENT' | 'NONCE_CONFLICT' | 'PARTIAL_FILL' |
  'LIQUIDATION_PROXIMITY' | 'POSITION_CHANGED' | 'EXECUTION_UNCERTAIN' |
  'UNKNOWN_LIQUIDATION' | 'UNVERIFIED_STATE';
export type CanaryAssessment = { verdict: 'GREEN' | 'AMBER' | 'RED';
  primary: CanarySignal | null; dependent: CanarySignal[]; reasons: string[];
  saferAction: string; provenance: 'LIVE_READ_ONLY' | 'REPLAYED' | 'SIMULATED' };
const red = new Set<CanarySignal>(['STALE_MARKET', 'IOC_NO_FILL', 'PRICE_DEVIATION',
  'INSUFFICIENT_MARGIN', 'INSUFFICIENT_GAS', 'REVOKED_PERMISSION', 'WRONG_CHAIN',
  'FOREIGN_ORDER', 'DUPLICATE_INTENT', 'NONCE_CONFLICT', 'LIQUIDATION_PROXIMITY',
  'POSITION_CHANGED']);
const actions: Record<CanarySignal, string> = {
  STALE_MARKET: 'Refresh the on-chain market and rebuild the plan.',
  IOC_NO_FILL: 'Inspect the live book and choose a new limit only within your slippage tolerance.',
  PRICE_DEVIATION: 'Rebuild the plan at the current mark price.',
  INSUFFICIENT_MARGIN: 'Reduce planned size or inspect Wallet 1 margin; do not bypass preview.',
  INSUFFICIENT_GAS: 'Check bot STT and gas estimate; do not broadcast underfunded.',
  REVOKED_PERMISSION: 'Review owner-granted BTC-PERP permission in dreamDEX.',
  WRONG_CHAIN: 'Switch to Hideki 50383 and rebuild the plan.',
  FOREIGN_ORDER: 'Do not act on an order not proven to belong to Wallet 1.',
  DUPLICATE_INTENT: 'Inspect the durable execution ledger before any new intent.',
  NONCE_CONFLICT: 'Wait for or reconcile the pending transaction.',
  PARTIAL_FILL: 'Reconcile order and position before another action.',
  LIQUIDATION_PROXIMITY: 'Reduce exposure manually only through a proven reduce-only path.',
  POSITION_CHANGED: 'Re-read the position and rebuild the plan.',
  EXECUTION_UNCERTAIN: 'Reconcile the signed transaction hash; never resend automatically.',
  UNKNOWN_LIQUIDATION: 'Check liquidation data before accepting position risk.',
  UNVERIFIED_STATE: 'Wait for on-chain evidence and repeat read-only checks.',
};
export function assessCanary(signals: CanarySignal[], provenance: CanaryAssessment['provenance']): CanaryAssessment {
  const unique = [...new Set(signals)];
  const primary = unique.find(signal => red.has(signal)) ?? unique[0] ?? null;
  const verdict = unique.some(signal => red.has(signal)) ? 'RED' : unique.length ? 'AMBER' : 'GREEN';
  return { verdict, primary, dependent: unique.filter(signal => signal !== primary),
    reasons: unique, saferAction: primary ? actions[primary] : 'No current blocker; still repeat all live checks before local execution.',
    provenance };
}
export function assessPlanCanary(plan: { status: 'PREPARED' | 'BLOCKED';
  checks: Record<string, boolean>; diagnostic?: { primaryError: string;
    blockedDependencies?: string[] } }): CanaryAssessment {
  const signals: CanarySignal[] = [];
  const failed = (name: string) => plan.checks[name] === false &&
    !plan.diagnostic?.blockedDependencies?.includes(name);
  if (plan.diagnostic?.primaryError === 'ImmediateOrCancelNoFill()') signals.push('IOC_NO_FILL');
  if (failed('market') || failed('fresh')) signals.push('STALE_MARKET');
  if (failed('chain')) signals.push('WRONG_CHAIN');
  if (failed('permission')) signals.push('REVOKED_PERMISSION');
  if (failed('margin')) signals.push('INSUFFICIENT_MARGIN');
  if (failed('gas')) signals.push('INSUFFICIENT_GAS');
  if (failed('owner')) signals.push('FOREIGN_ORDER');
  if (failed('active') || failed('quantity') || failed('simulation') || failed('targetAndCalldata'))
    signals.push('UNVERIFIED_STATE');
  if (plan.status === 'BLOCKED' && signals.length === 0) signals.push('UNVERIFIED_STATE');
  return assessCanary(signals, 'LIVE_READ_ONLY');
}

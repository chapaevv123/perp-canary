import type { PreparedPlan } from './delegated-plan.ts';
import type { inspectTradingAuthorization } from './trading-authorization.ts';

type Observation = Awaited<ReturnType<typeof inspectTradingAuthorization>>;
type GateStatus = 'PASS' | 'FAILED' | 'NOT_RUN' | 'UNKNOWN';
const gate = (passed: boolean): GateStatus => passed ? 'PASS' : 'FAILED';

export function summarizePreflightBlockers(observation: Observation, plan: PreparedPlan) {
  const failures: string[] = [];
  const actions: string[] = [];
  const preview = observation.marginPreview;
  const maximum = observation.maximumPlaceable;
  if (preview.status === 'READ_ERROR') {
    failures.push('MARGIN_PREVIEW_READ_ERROR');
    actions.push('Repeat read-only margin preview when the SDK or RPC is available.');
  } else if (preview.status === 'UNPRICEABLE') {
    failures.push('MARGIN_PREVIEW_UNPRICEABLE');
    actions.push('Wait for a fresh mark price and rebuild the plan.');
  } else if (preview.status === 'OK' && !preview.sufficient) {
    const causes = [
      ['voucherBlocked', preview.voucherBlocked],
      ['restrictedBlocked', preview.restrictedBlocked],
      ['isolationBlocked', preview.isolationBlocked],
      ['insufficientCollateralForLock', !preview.hasCollateralForLock],
      ['initialMarginNotMet', !preview.meetsInitialMargin],
    ] as const;
    for (const [name, active] of causes) if (active) failures.push(`MARGIN_PREVIEW_${name}`);
    if (!failures.length) failures.push('MARGIN_PREVIEW_NOT_SUFFICIENT');
    actions.push('Review Wallet 1 collateral, existing position and SDK margin gates; select a new size only after a fresh preview.');
  }
  if (maximum.status === 'READ_ERROR') {
    failures.push('MAX_PLACEABLE_READ_ERROR');
    actions.push('Repeat the SDK maximum placeable size read; do not infer a size.');
  } else if (maximum.status === 'UNPRICEABLE') {
    failures.push('MAX_PLACEABLE_UNPRICEABLE');
    actions.push('Wait for a fresh mark price before requesting a maximum size.');
  } else if (maximum.status === 'OK' &&
    (!maximum.placeable || BigInt(maximum.requestedQuantityRaw) > BigInt(maximum.maxQuantityRaw))) {
    failures.push(`MAX_PLACEABLE_${maximum.limitedBy}`);
    actions.push('Review the SDK limit and minimum lot; choose a fresh owner-approved size only if every risk gate passes.');
  }
  const unsignedAbsent = observation.unsigned === null;
  const gasMeasured = /^\d+$/.test(observation.estimatedGasUnits) &&
    /^\d+$/.test(observation.gasPriceWei);
  const marginUnknown = [preview.status, maximum.status].some(status =>
    status === 'READ_ERROR' || status === 'UNPRICEABLE' || status === 'NOT_RUN');
  const knownMarginFailure = (preview.status === 'OK' && !preview.sufficient) ||
    (maximum.status === 'OK' && (!maximum.placeable ||
      BigInt(maximum.requestedQuantityRaw) > BigInt(maximum.maxQuantityRaw)));
  const gates: Record<keyof PreparedPlan['checks'], GateStatus> = {
    chain: gate(observation.chainId === 50383),
    market: gate(plan.checks.market), permission: gate(plan.checks.permission),
    margin: plan.checks.margin ? 'PASS' : knownMarginFailure ? 'FAILED' : marginUnknown ? 'UNKNOWN' : 'FAILED',
    gas: unsignedAbsent && !gasMeasured ? 'NOT_RUN' : gate(plan.checks.gas),
    simulation: observation.simulation.status === 'UNKNOWN' ? 'NOT_RUN' : gate(plan.checks.simulation),
    fresh: unsignedAbsent ? 'NOT_RUN' : gate(plan.checks.fresh),
    notional: gate(plan.checks.notional),
    targetAndCalldata: unsignedAbsent ? 'NOT_RUN' : gate(plan.checks.targetAndCalldata),
  };
  return { primaryFailures: failures.length ? failures : plan.blockers.filter(x => !x.endsWith(' gate failed')),
    gates, margin: { unlockedCollateral: observation.marginBankUnlocked,
      positionSizeRaw: observation.positionSizeRaw, preview, maximum },
    ownerActions: [...new Set(actions)], transactionSent: 'NO' as const };
}

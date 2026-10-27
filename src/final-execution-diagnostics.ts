import type { TransactionSerializable } from 'viem';
import { ExecutionStageError, type PreflightState } from './delegated-execution.ts';

export type FinalExecutionStage = 'KEYSTORE_UNLOCK' | 'LOCAL_SIGN' | 'SIGNATURE_VERIFY' |
  'NONCE' | 'GAS' | 'MARKET' | 'EXPIRY' | 'CALLDATA' | 'PERMISSIONS' | 'MARGIN' | 'UNKNOWN';
export type FinalExecutionFailure = { passed: false; stage: FinalExecutionStage; reason: string };
export class FinalExecutionError extends Error {
  readonly failure: FinalExecutionFailure;
  constructor(stage: FinalExecutionStage, reason: string) {
    super(`${stage}: ${reason}`);
    this.name = 'FinalExecutionError';
    this.failure = { passed: false, stage, reason };
  }
}
const fail = (stage: FinalExecutionStage, reason: string): FinalExecutionFailure =>
  ({ passed: false, stage, reason });

export function classifyPreflightBlockers(blockers: string[]): FinalExecutionFailure {
  const joined = blockers.join(' | ').toLowerCase();
  if (/expired|clock invalid/.test(joined)) return fail('EXPIRY', 'PLAN_EXPIRED_OR_CLOCK_INVALID');
  if (/nonce/.test(joined)) return fail('NONCE', 'NONCE_CHANGED_OR_PENDING');
  if (/gas|balance/.test(joined)) return fail('GAS', 'GAS_BUDGET_OR_BALANCE_FAILED');
  if (/permission|grant|operator/.test(joined)) return fail('PERMISSIONS', 'OPERATOR_PERMISSION_UNAVAILABLE');
  if (/margin|collateral|placeable/.test(joined)) return fail('MARGIN', 'MARGIN_OR_SIZE_FAILED');
  if (/calldata|target|sender/.test(joined)) return fail('CALLDATA', 'CALLDATA_OR_TARGET_MISMATCH');
  if (/chain/.test(joined)) return fail('SIGNATURE_VERIFY', 'CHAIN_ID_MISMATCH');
  if (/simulation/.test(joined)) return fail('UNKNOWN', 'SIMULATION_FAILED');
  if (/postonly would cross/.test(joined)) return fail('MARKET', 'POST_ONLY_WOULD_CROSS');
  if (/mark moved more than 1%/.test(joined)) return fail('MARKET', 'MARK_DEVIATION_OVER_1_PERCENT');
  if (/position changed/.test(joined)) return fail('MARKET', 'POSITION_CHANGED');
  if (/untrusted_market_snapshot/.test(joined)) return fail('MARKET', 'UNTRUSTED_MARKET_SNAPSHOT');
  if (/market|book|mark|price|position|snapshot|stale|fresh/.test(joined))
    return fail('MARKET', 'MARKET_OR_POSITION_CHANGED');
  return fail('UNKNOWN', 'PREFLIGHT_FAILED');
}

export function classifyPreflightError(error: unknown): FinalExecutionFailure {
  if (error instanceof FinalExecutionError) return error.failure;
  if (error instanceof ExecutionStageError) {
    if (error.stage === 'NONCE') return fail('NONCE', 'NONCE_READ_FAILED');
    if (['GAS_PRICE', 'GAS_BALANCE', 'ESTIMATE_GAS'].includes(error.stage))
      return fail('GAS', 'GAS_READ_OR_SIMULATION_FAILED');
    if (error.stage === 'CHAIN') return fail('SIGNATURE_VERIFY', 'CHAIN_READ_FAILED');
    if (error.stage === 'FRESH_STATE' || error.stage === 'PREFLIGHT')
      return classifyPreflightBlockers([error.original instanceof Error ? error.original.message : '']);
  }
  return fail('UNKNOWN', 'PREFLIGHT_READ_FAILED');
}

export function finalCheckFailure(check: PreflightState,
  transaction: TransactionSerializable): FinalExecutionFailure | null {
  if (!check.passed) return classifyPreflightBlockers(check.blockers);
  if (check.nonce !== transaction.nonce) return fail('NONCE', 'SIGNED_NONCE_STALE');
  if (BigInt(check.gasPriceWei) > BigInt(transaction.gasPrice ?? 0n))
    return fail('GAS', 'SIGNED_GAS_PRICE_STALE');
  if (BigInt(check.gasBalanceWei) < BigInt(transaction.gas ?? 0n) * BigInt(transaction.gasPrice ?? 0n))
    return fail('GAS', 'SIGNED_GAS_BALANCE_INSUFFICIENT');
  return null;
}

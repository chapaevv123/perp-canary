import { contractErrorsAbi } from '@somnia-chain/markets-sdk';
import { decodeErrorResult, keccak256, toBytes, type Hex } from 'viem';

export type ExecutionStage = 'PLAN_LOAD' | 'BROWSER_PREFLIGHT' | 'FRESH_STATE' | 'CHAIN' | 'NONCE' | 'GAS_PRICE' |
  'GAS_BALANCE' | 'ESTIMATE_GAS' | 'SIMULATE_CONTRACT' | 'ETH_CALL' | 'PREFLIGHT' |
  'SIGN' | 'BROADCAST' | 'RECEIPT';
export type ErrorClass = 'CONTRACT_REVERT' | 'RPC_TRANSPORT' | 'SDK' | 'LOCAL_VALIDATION' |
  'EXECUTION_UNCERTAINTY';
export type ExecutionReason = 'IOC_NO_FILL' | 'INSUFFICIENT_MARGIN' | 'PERMISSION_DENIED' |
  'WRONG_CHAIN' | 'INVALID_ORDER' | 'INVALID_QUANTITY' | 'PRICE_OUT_OF_BOUNDS' |
  'INSUFFICIENT_COLLATERAL' | 'MAX_POSITION_SIZE' | 'MARKET_BLOCKED' |
  'POST_ONLY_WOULD_CROSS' | 'STALE_MARKET' |
  'UNTRUSTED_MARKET_SNAPSHOT' |
  'NONCE_CONFLICT' | 'PLAN_EXPIRED' | 'UNKNOWN_REVERT' | 'RPC_FAILURE' |
  'SDK_FAILURE' | 'LOCAL_FAILURE' | 'BROADCAST_UNKNOWN';
export type DecodedExecutionError = { stage: ExecutionStage; errorClass: ErrorClass;
  reason: ExecutionReason; selector: string | null; contractError: string | null;
  rootCause: string; dependentFailures: string[]; safeNextAction: string;
  transactionSent: 'NO' | 'UNKNOWN' | 'YES'; rpcCode: number | null;
  nestedCauseNames: string[] };

const names: Record<string, ExecutionReason> = {
  ImmediateOrCancelNoFill: 'IOC_NO_FILL',
  InsufficientMargin: 'INSUFFICIENT_MARGIN',
  InsufficientMarginForOrder: 'INSUFFICIENT_MARGIN',
  InsufficientMarginAtCreation: 'INSUFFICIENT_MARGIN',
  InsufficientCollateral: 'INSUFFICIENT_COLLATERAL',
  MaxPositionSizeExceeded: 'MAX_POSITION_SIZE',
  VoucherMarketNotAllowed: 'MARKET_BLOCKED',
  MarketRestricted: 'MARKET_BLOCKED',
  FreshMarketRequired: 'STALE_MARKET',
  PostOnlyWouldCross: 'POST_ONLY_WOULD_CROSS',
  OnlyApprovedContracts: 'PERMISSION_DENIED',
  InvalidOrderOwner: 'INVALID_ORDER',
  InvalidOrderPair: 'INVALID_ORDER',
  OrderAlreadyExpired: 'PLAN_EXPIRED',
  InvalidQuantity: 'INVALID_QUANTITY',
  QuantityBelowMinimum: 'INVALID_QUANTITY',
  InvalidPrice: 'PRICE_OUT_OF_BOUNDS',
  PriceOutOfBounds: 'PRICE_OUT_OF_BOUNDS',
};
const verifiedAbi = contractErrorsAbi.filter(item => item.type === 'error' && item.name in names);
const knownSelectors = new Set<string>(verifiedAbi.map(item =>
  keccak256(toBytes(`${item.name}(${item.inputs.map(input => input.type).join(',')})`)).slice(0, 10)));
const defaultAction = 'Inspect saved diagnostics, refresh live state, and create a new plan; do not bypass simulation.';
const actions: Partial<Record<ExecutionReason, string>> = {
  IOC_NO_FILL: 'Review the current ask and your slippage limit, then create a fresh plan with a manually chosen limit.',
  INSUFFICIENT_MARGIN: 'Recheck unlocked margin and position; create a fresh plan only after collateral is sufficient.',
  INSUFFICIENT_COLLATERAL: 'Recheck available collateral and voucher restrictions before creating a fresh plan.',
  MAX_POSITION_SIZE: 'Review current position and protocol size limits; do not increase the approved quantity.',
  MARKET_BLOCKED: 'Check the official market and voucher allowlist; do not bypass the blocked market.',
  POST_ONLY_WOULD_CROSS: 'Refresh the book and manually choose a non-marketable price in a new plan.',
  STALE_MARKET: 'Wait for a fresh supported mark and book, then create a new plan.',
  UNTRUSTED_MARKET_SNAPSHOT: 'Discard this plan, inspect raw book metadata, and repeat independent read-only market checks.',
  PERMISSION_DENIED: 'Verify the bot grant for this owner and BTC-PERP before creating a fresh plan.',
  WRONG_CHAIN: 'Connect to Hideki 50383 and recheck; never send on another chain.',
  NONCE_CONFLICT: 'Inspect pending bot transactions and reconcile before preparing a new independent intent.',
  PLAN_EXPIRED: 'Discard this plan and create a fresh one.',
  BROADCAST_UNKNOWN: 'Do not retry. Reconcile the reserved signed hash against the chain.',
  RPC_FAILURE: 'Check Hideki RPC health and repeat read-only checks; never bypass simulation.',
};
function nested(error: unknown): { data: Hex | null; code: number | null; message: string;
  causeNames: string[] } {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  let data: Hex | null = null;
  let code: number | null = null;
  let message = '';
  const causeNames: string[] = [];
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const value = current as Record<string, unknown>;
    if (typeof value.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(value.name))
      causeNames.push(value.name);
    if (typeof value.code === 'number' && code === null) code = value.code;
    if (typeof value.data === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value.data) &&
      value.data.length >= 10 && data === null) data = value.data as Hex;
    if (typeof value.message === 'string' && !message) message = value.message.slice(0, 300);
    for (const child of [value.cause, value.data, value.error, value.originalError])
      if (child && typeof child === 'object') queue.push(child);
  }
  return { data, code, message, causeNames: [...new Set(causeNames)] };
}
export function decodeExecutionError(error: unknown, stage: ExecutionStage,
  transactionSent: 'NO' | 'UNKNOWN' | 'YES' = 'NO'): DecodedExecutionError {
  const extracted = nested(error);
  const selector = extracted.data?.slice(0, 10).toLowerCase() ?? null;
  let contractError: string | null = null;
  let reason: ExecutionReason = 'UNKNOWN_REVERT';
  if (selector && knownSelectors.has(selector)) {
    try {
      const decoded = decodeErrorResult({ abi: verifiedAbi, data: extracted.data! });
      contractError = `${decoded.errorName}()`;
      reason = names[decoded.errorName] ?? 'UNKNOWN_REVERT';
    } catch { /* Keep unknown selector or malformed ABI data unknown. */ }
  }
  const lower = extracted.message.toLowerCase();
  let errorClass: ErrorClass = 'CONTRACT_REVERT';
  if (transactionSent === 'UNKNOWN' || stage === 'BROADCAST') {
    errorClass = 'EXECUTION_UNCERTAINTY';
    reason = 'BROADCAST_UNKNOWN';
  } else if (!selector && /UNTRUSTED_MARKET_SNAPSHOT/.test(extracted.message)) {
    errorClass = 'LOCAL_VALIDATION'; reason = 'UNTRUSTED_MARKET_SNAPSHOT';
  } else if (!selector && /chain.*(mismatch|wrong)|wrong chain/.test(lower)) {
    errorClass = 'LOCAL_VALIDATION'; reason = 'WRONG_CHAIN';
  } else if (!selector && /expired|expiry/.test(lower) && stage !== 'ESTIMATE_GAS') {
    errorClass = 'LOCAL_VALIDATION'; reason = 'PLAN_EXPIRED';
  } else if (!selector && /nonce/.test(lower) && stage !== 'ESTIMATE_GAS') {
    errorClass = 'LOCAL_VALIDATION'; reason = 'NONCE_CONFLICT';
  } else if (!selector && (/timeout|timed out|fetch failed|network|econn|eacces|rpc/.test(lower) ||
    (extracted.code !== null && extracted.code !== 3 && !/revert/.test(lower))) &&
    !/execution reverted/.test(lower)) {
    errorClass = 'RPC_TRANSPORT'; reason = 'RPC_FAILURE';
  } else if (!selector && /sdk|indexer/.test(lower)) {
    errorClass = 'SDK'; reason = 'SDK_FAILURE';
  } else if (!selector && !/revert|execution reverted/.test(lower) && extracted.code !== 3) {
    errorClass = 'LOCAL_VALIDATION'; reason = 'LOCAL_FAILURE';
  }
  const rootCause = contractError ? `${contractError} confirmed by official SDK ABI selector` :
    reason === 'UNKNOWN_REVERT' ? 'Contract reverted; no confirmed error selector was available' :
      reason === 'BROADCAST_UNKNOWN' ? 'The send or receipt outcome is uncertain' :
        `${reason} at ${stage}`;
  return { stage, errorClass, reason, selector, contractError, rootCause,
    dependentFailures: stage === 'ESTIMATE_GAS' ? ['preflight', 'confirmation', 'signing', 'broadcast'] : [],
    safeNextAction: actions[reason] ?? defaultAction, transactionSent, rpcCode: extracted.code,
    nestedCauseNames: extracted.causeNames };
}

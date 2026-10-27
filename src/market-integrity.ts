import { formatUnits } from 'viem';
import { RPC } from './rpc-health.ts';
import { BTC_POOL } from './trade-forensics.ts';

export const MAX_BOOK_AGE_MS = 30_000;
const MAX_FUTURE_SKEW_MS = 5_000;
export const BOOK_SOURCE = 'SDK_ONCHAIN_PINNED_AND_DIRECT_HTTPS' as const;
export type MarketBookSnapshot = { market?: string; pool?: string; source?: string; rpcUrl?: string;
  blockNumber: string; blockHash?: string; blockTimestamp?: string; observedAt?: string;
  postReadBlockHash?: string;
  quoteDecimals?: number; tickSizeRaw?: string; bestBidRaw: string; bestAskRaw: string;
  directBestBidRaw?: string; directBestAskRaw?: string };
export type MarketIntegrity = { status: 'TRUSTED' | 'UNTRUSTED_MARKET_SNAPSHOT';
  reasons: string[]; bestBidRaw: string; bestAskRaw: string;
  bestBid: string; bestAsk: string; source: string; blockNumber: string;
  blockHash: string; postReadBlockHash: string; blockTimestamp: string; observedAt: string };
const decimal = (value: string | undefined) => !!value && /^\d+$/.test(value);
const same = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
function time(value: string | undefined): number | null {
  if (!value || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
export function validateMarketSnapshot(snapshot: MarketBookSnapshot | null | undefined,
  context: { market: string; pool: string; sampledBlock: string; markPriceRaw?: string;
    now?: number }): MarketIntegrity {
  const reasons: string[] = [];
  const now = context.now ?? Date.now();
  const bidRaw = snapshot?.bestBidRaw ?? 'UNKNOWN';
  const askRaw = snapshot?.bestAskRaw ?? 'UNKNOWN';
  let bid: bigint | null = null;
  let ask: bigint | null = null;
  if (!decimal(bidRaw)) reasons.push('MISSING_OR_INVALID_BID');
  else { bid = BigInt(bidRaw); if (bid <= 0n) reasons.push('NONPOSITIVE_BID'); }
  if (!decimal(askRaw)) reasons.push('MISSING_OR_INVALID_ASK');
  else { ask = BigInt(askRaw); if (ask <= 0n) reasons.push('NONPOSITIVE_ASK'); }
  if (bid !== null && ask !== null && bid > 0n && ask > 0n && bid >= ask)
    reasons.push(bid === ask ? 'LOCKED_BOOK' : 'CROSSED_BOOK');
  if (context.market !== 'BTC-PERP' || !same(context.pool, BTC_POOL) ||
    snapshot?.market !== 'BTC-PERP' || !same(snapshot.pool, BTC_POOL)) reasons.push('WRONG_MARKET');
  if (snapshot?.source !== BOOK_SOURCE || snapshot?.rpcUrl !== RPC)
    reasons.push('INCOMPATIBLE_OR_MISSING_SOURCE');
  if (!decimal(snapshot?.blockNumber) || snapshot?.blockNumber !== context.sampledBlock)
    reasons.push('BLOCK_MISMATCH_OR_MISSING');
  if (!snapshot?.blockHash || !/^0x[0-9a-fA-F]{64}$/.test(snapshot.blockHash))
    reasons.push('MISSING_BLOCK_HASH');
  if (!snapshot?.postReadBlockHash || !/^0x[0-9a-fA-F]{64}$/.test(snapshot.postReadBlockHash))
    reasons.push('MISSING_POST_READ_BLOCK_HASH');
  else if (snapshot?.blockHash?.toLowerCase() !== snapshot.postReadBlockHash.toLowerCase())
    reasons.push('BLOCK_HASH_CHANGED_DURING_READ');
  const blockTime = time(snapshot?.blockTimestamp);
  const observedTime = time(snapshot?.observedAt);
  if (blockTime === null || observedTime === null) reasons.push('MISSING_FRESHNESS_METADATA');
  else if (now - blockTime > MAX_BOOK_AGE_MS || blockTime - now > MAX_FUTURE_SKEW_MS ||
    now - observedTime > MAX_BOOK_AGE_MS || observedTime - now > MAX_FUTURE_SKEW_MS ||
    observedTime + MAX_FUTURE_SKEW_MS < blockTime)
    reasons.push('STALE_OR_INCONSISTENT_BOOK_TIME');
  if (snapshot?.quoteDecimals !== 18 || !decimal(snapshot.tickSizeRaw) ||
    BigInt(snapshot.tickSizeRaw ?? '0') <= 0n) reasons.push('UNKNOWN_PRICE_UNITS');
  else if (bid !== null && ask !== null &&
    (bid % BigInt(snapshot.tickSizeRaw!) !== 0n || ask % BigInt(snapshot.tickSizeRaw!) !== 0n))
    reasons.push('PRICE_OFF_TICK_GRID');
  if (!decimal(snapshot?.directBestBidRaw) || !decimal(snapshot?.directBestAskRaw) ||
    snapshot?.directBestBidRaw !== bidRaw || snapshot?.directBestAskRaw !== askRaw)
    reasons.push('SDK_DIRECT_RPC_MISMATCH');
  if (decimal(context.markPriceRaw) && bid !== null && ask !== null) {
    const mark = BigInt(context.markPriceRaw!);
    if (mark <= 0n || bid > mark * 10n || ask > mark * 10n ||
      bid * 10n < mark || ask * 10n < mark) reasons.push('OBVIOUS_UNIT_OR_MARK_MISMATCH');
  }
  return { status: reasons.length ? 'UNTRUSTED_MARKET_SNAPSHOT' : 'TRUSTED', reasons,
    bestBidRaw: bidRaw, bestAskRaw: askRaw,
    bestBid: bid !== null && bid > 0n ? formatUnits(bid, 18) : 'UNKNOWN',
    bestAsk: ask !== null && ask > 0n ? formatUnits(ask, 18) : 'UNKNOWN',
    source: snapshot?.source ?? 'UNKNOWN', blockNumber: snapshot?.blockNumber ?? 'UNKNOWN',
    blockHash: snapshot?.blockHash ?? 'UNKNOWN',
    postReadBlockHash: snapshot?.postReadBlockHash ?? 'UNKNOWN',
    blockTimestamp: snapshot?.blockTimestamp ?? 'UNKNOWN',
    observedAt: snapshot?.observedAt ?? 'UNKNOWN' };
}

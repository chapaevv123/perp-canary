import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUnits } from 'viem';
import { BOOK_SOURCE, MAX_BOOK_AGE_MS, validateMarketSnapshot,
  type MarketBookSnapshot } from '../src/market-integrity.ts';
import { BTC_POOL } from '../src/trade-forensics.ts';
import { RPC } from '../src/rpc-health.ts';

const now = Date.parse('2026-10-27T09:00:00.000Z');
const raw = (value: string) => parseUnits(value, 18).toString();
const context = { market: 'BTC-PERP', pool: BTC_POOL, sampledBlock: '123',
  markPriceRaw: raw('80000'), now };
const base: MarketBookSnapshot = { market: 'BTC-PERP', pool: BTC_POOL,
  source: BOOK_SOURCE, rpcUrl: RPC, blockNumber: '123', blockHash: `0x${'ab'.repeat(32)}`,
  postReadBlockHash: `0x${'ab'.repeat(32)}`,
  blockTimestamp: '2026-10-27T08:59:59.000Z', observedAt: '2026-10-27T09:00:00.000Z',
  quoteDecimals: 18, tickSizeRaw: raw('0.1'),
  bestBidRaw: raw('79999.9'), bestAskRaw: raw('80000.1'),
  directBestBidRaw: raw('79999.9'), directBestAskRaw: raw('80000.1') };
const result = (changes: Partial<MarketBookSnapshot>, ctx = context) =>
  validateMarketSnapshot({ ...base, ...changes }, ctx);

test('valid pinned two-sided BTC book preserves raw/normalized 18-decimal prices', () => {
  const inspected = result({});
  assert.equal(inspected.status, 'TRUSTED');
  assert.deepEqual(inspected.reasons, []);
  assert.equal(inspected.bestBid, '79999.9');
  assert.equal(inspected.bestAsk, '80000.1');
  assert.equal(MAX_BOOK_AGE_MS, 30_000);
});

test('crossed and locked books are untrusted without swapping or repairing sides', () => {
  const crossed = result({ bestBidRaw: raw('80001'), directBestBidRaw: raw('80001') });
  assert.equal(crossed.status, 'UNTRUSTED_MARKET_SNAPSHOT');
  assert.ok(crossed.reasons.includes('CROSSED_BOOK'));
  assert.equal(crossed.bestBid, '80001');
  const locked = result({ bestBidRaw: raw('80000.1'), directBestBidRaw: raw('80000.1') });
  assert.ok(locked.reasons.includes('LOCKED_BOOK'));
});

test('missing, zero, negative and malformed sides fail closed', () => {
  for (const [change, reason] of [
    [{ bestBidRaw: 'UNKNOWN' }, 'MISSING_OR_INVALID_BID'],
    [{ bestAskRaw: 'UNKNOWN' }, 'MISSING_OR_INVALID_ASK'],
    [{ bestBidRaw: '0' }, 'NONPOSITIVE_BID'],
    [{ bestAskRaw: '0' }, 'NONPOSITIVE_ASK'],
    [{ bestBidRaw: '-1' }, 'MISSING_OR_INVALID_BID'],
    [{ bestAskRaw: '79,900' }, 'MISSING_OR_INVALID_ASK'],
  ] as const) assert.ok(result(change).reasons.includes(reason));
});

test('market, units, tick grid, source and block provenance must agree', () => {
  assert.ok(result({ market: 'ETH-PERP' }).reasons.includes('WRONG_MARKET'));
  assert.ok(result({ pool: `0x${'11'.repeat(20)}` }).reasons.includes('WRONG_MARKET'));
  assert.ok(result({ quoteDecimals: 6 }).reasons.includes('UNKNOWN_PRICE_UNITS'));
  assert.ok(result({ bestAskRaw: raw('80000.15'), directBestAskRaw: raw('80000.15') })
    .reasons.includes('PRICE_OFF_TICK_GRID'));
  assert.ok(result({ source: 'INDEXER' }).reasons.includes('INCOMPATIBLE_OR_MISSING_SOURCE'));
  assert.ok(result({ blockNumber: '122' }).reasons.includes('BLOCK_MISMATCH_OR_MISSING'));
  assert.ok(result({ postReadBlockHash: `0x${'cd'.repeat(32)}` })
    .reasons.includes('BLOCK_HASH_CHANGED_DURING_READ'));
  assert.ok(result({ directBestAskRaw: raw('80001') }).reasons.includes('SDK_DIRECT_RPC_MISMATCH'));
  assert.ok(result({ bestAskRaw: raw('8000000'), directBestAskRaw: raw('8000000') })
    .reasons.includes('OBVIOUS_UNIT_OR_MARK_MISMATCH'));
});

test('stale or absent real timestamps never imply freshness', () => {
  assert.ok(result({ blockTimestamp: '2026-10-27T08:59:00.000Z' })
    .reasons.includes('STALE_OR_INCONSISTENT_BOOK_TIME'));
  assert.ok(result({ observedAt: undefined }).reasons.includes('MISSING_FRESHNESS_METADATA'));
  assert.ok(result({ blockTimestamp: undefined }).reasons.includes('MISSING_FRESHNESS_METADATA'));
  assert.ok(result({ blockTimestamp: '2026-10-27T09:01:00.000Z' })
    .reasons.includes('STALE_OR_INCONSISTENT_BOOK_TIME'));
});

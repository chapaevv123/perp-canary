import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnits } from 'viem';
import { ownerBuyLimitReasons, priceReport, type PriceObservation } from '../src/first-proof.ts';
import { BTC_POOL, OWNER_TRADING_WALLET } from '../src/trade-forensics.ts';
import { BOOK_SOURCE, validateMarketSnapshot } from '../src/market-integrity.ts';
import { RPC } from '../src/rpc-health.ts';

const raw = (v: string) => parseUnits(v, 18).toString();
function fixture(now = Date.now()): PriceObservation {
  const bookTops = { market: 'BTC-PERP', pool: BTC_POOL, source: BOOK_SOURCE, rpcUrl: RPC,
    blockNumber: '10', blockHash: `0x${'1'.repeat(64)}`, postReadBlockHash: `0x${'1'.repeat(64)}`,
    blockTimestamp: new Date(now - 1000).toISOString(), observedAt: new Date(now).toISOString(),
    quoteDecimals: 18, tickSizeRaw: raw('0.1'), bestBidRaw: raw('80000'),
    bestAskRaw: raw('80002'), directBestBidRaw: raw('80000'), directBestAskRaw: raw('80002') };
  return { chainId: 50383, market: 'BTC-PERP', pool: BTC_POOL,
    tradingWallet: OWNER_TRADING_WALLET, sampledBlock: '10',
    bookTops, marketIntegrity: validateMarketSnapshot(bookTops, { market: 'BTC-PERP',
      pool: BTC_POOL, sampledBlock: '10', markPriceRaw: raw('80000'), now }),
    marketGrid: { minQuantityRaw: '13000', lotSizeRaw: '1000', tickSizeRaw: raw('0.1'),
      baseDecimals: 8, quoteDecimals: 18 }, markPriceRaw: raw('80000'),
    marketSupported: { status: 'SUPPORTED' }, registryMatches: { status: 'SUPPORTED' },
    permissions: { place: { effective: { status: 'SUPPORTED' } } },
    marginBankUnlocked: '1000', operatorGasStt: '5' } as unknown as PriceObservation;
}
test('fresh trusted BTC book offers three owner-selectable tick prices within risk limits', () => {
  const result = priceReport(fixture());
  assert.equal(result.status, 'READY');
  assert.equal(result.chosenQuantity, '0.00013');
  assert.deepEqual(result.candidates.map(c => c.offsetBps), [10, 25, 50]);
  assert.ok(result.candidates.every(c => c.status === 'CANDIDATE' &&
    BigInt(raw(c.price)) < BigInt(raw(result.bestBid)) &&
    BigInt(raw(c.notional)) <= parseUnits('100', 18)));
});
test('changed crossed book and expired quote block all suggestions', () => {
  const good = fixture();
  const crossed = { ...good, marketIntegrity: { ...good.marketIntegrity,
    status: 'UNTRUSTED_MARKET_SNAPSHOT' as const, reasons: ['CROSSED_BOOK'] } };
  assert.equal(priceReport(crossed).status, 'BLOCKED');
  assert.ok(priceReport(crossed).candidates.every(c => c.status === 'BLOCKED'));
  assert.equal(priceReport(good, Date.parse(good.bookTops.observedAt!) + 31_000).status, 'BLOCKED');
});
test('mark deviation, margin, min grid and revoked permission fail closed', () => {
  const good = fixture();
  const farMark = { ...good, markPriceRaw: raw('81000') };
  assert.equal(priceReport(farMark).status, 'BLOCKED');
  assert.ok(priceReport(farMark).candidates.every(c => c.reasons.some(r => r.includes('1%'))));
  assert.equal(priceReport({ ...good, marginBankUnlocked: '1' }).status, 'BLOCKED');
  assert.equal(priceReport({ ...good, marketGrid: { ...good.marketGrid,
    minQuantityRaw: 'UNKNOWN' } }).status, 'BLOCKED');
  assert.equal(priceReport({ ...good, permissions: { ...good.permissions,
    place: { ...good.permissions.place, effective: { ...good.permissions.place.effective,
      status: 'BLOCKED' } } } }).status, 'BLOCKED');
});
test('suggestion never crosses a moved ask even when historical quote was safe', () => {
  const good = fixture();
  const moved = { ...good, bookTops: { ...good.bookTops,
    bestAskRaw: raw('79900'), directBestAskRaw: raw('79900') } };
  const report = priceReport(moved);
  assert.equal(report.status, 'BLOCKED');
  assert.ok(report.candidates.every(c => c.reasons.some(r => r.includes('CROSSED_BOOK'))));
});
test('owner override is checked against current ask, mark, tick, quantity and notional', () => {
  const current = fixture();
  assert.deepEqual(ownerBuyLimitReasons(current, '79920', '0.00013'), []);
  assert.ok(ownerBuyLimitReasons(current, '80002', '0.00013').some(r => r.includes('cross')));
  assert.ok(ownerBuyLimitReasons(current, '79000', '0.00013').some(r => r.includes('1%')));
  assert.ok(ownerBuyLimitReasons(current, '79920.01', '0.00013').some(r => r.includes('tick')));
  assert.ok(ownerBuyLimitReasons(current, '79920', '0.00012').some(r => r.includes('minimum')));
  assert.ok(ownerBuyLimitReasons(current, '79920', '0.013').some(r => r.includes('100 USDso')));
});

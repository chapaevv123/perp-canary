import assert from 'node:assert/strict';
import test from 'node:test';
import { assessDirectTrade, type DirectInput, type TradeObservation } from '../src/browser-trade.ts';

const account = '0x1111111111111111111111111111111111111111';
const input: DirectInput = { account, side: 'BUY', orderType: 'POST_ONLY', price: '79806.1', quantity: '0.00013' };
function observation(): TradeObservation {
  const observedAt = new Date().toISOString();
  return { chainId: 50383, observedAt, block: '34620366',
    pool: '0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0',
    marginBank: '0x478769E1177C0773c43A593DCCc4Ad15F15F1394',
    book: { status: 'TRUSTED', observedAt, bid: '79806.1', ask: '79806.3' }, mark: '79800',
    depth: { status: 'VERIFIED', bids: [{ quantity: '0.001' }], asks: [{ quantity: '0.001' }] },
    grid: { tickSizeRaw: '100000000000000000', lotSizeRaw: '1000', minQuantityRaw: '13000',
      baseDecimals: 8, quoteDecimals: 18 },
    account: { address: account, gasWei: '1000000000000000000', walletUsdsoRaw: '100000000000000000000',
      marginUnlockedRaw: '50000000000000000000', maxQuantityRaw: '100000', maxPriceable: true,
      maxPlaceable: true, limitedBy: 'MARGIN' } };
}

test('direct trade guard accepts only a fresh, grid aligned, margin placeable PostOnly limit', () => {
  assert.equal(assessDirectTrade(input, observation()).verdict, 'GREEN');
  assert.equal(assessDirectTrade({ ...input, side: 'SELL', price: '79806.3' }, observation()).verdict, 'AMBER');
  assert.equal(assessDirectTrade({ ...input, price: '79806.3' }, observation()).verdict, 'RED');
  assert.equal(assessDirectTrade({ ...input, price: '79806.15' }, observation()).verdict, 'RED');
  assert.equal(assessDirectTrade({ ...input, quantity: '0.01' }, observation()).verdict, 'RED');
  assert.equal(assessDirectTrade({ ...input, orderType: 'IOC' as DirectInput['orderType'] }, observation()).verdict, 'RED');
});

test('direct trade guard blocks stale books, wrong chain, missing gas and insufficient margin size', () => {
  const stale = observation(); stale.book.observedAt = new Date(Date.now() - 31_000).toISOString();
  assert.match(assessDirectTrade(input, stale).blockers.join(' '), /stale/);
  const wrong = observation(); wrong.chainId = 1;
  assert.match(assessDirectTrade(input, wrong).blockers.join(' '), /Wrong network/);
  const noGas = observation(); noGas.account.gasWei = '0';
  assert.match(assessDirectTrade(input, noGas).blockers.join(' '), /no STT/);
  const noMargin = observation(); noMargin.account.maxPlaceable = false;
  assert.match(assessDirectTrade(input, noMargin).blockers.join(' '), /Margin size unavailable/);
});

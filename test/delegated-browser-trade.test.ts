import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeFunctionData, toFunctionSelector } from 'viem';
import { DELEGATED_CANCEL_ABI, DELEGATED_PLACE_ABI, OrderNotOpenError,
  delegatedGate, requireOpenDelegatedOrder } from '../src/delegated-browser-trade.ts';
import { EXPECTED_METAMASK, KNOWN_EMBEDDED } from '../src/wallet-funding.ts';

const input = { mode: 'DELEGATED_PERPS' as const, owner: KNOWN_EMBEDDED,
  account: EXPECTED_METAMASK, market: 'BTC-PERP', side: 'BUY' as const,
  orderType: 'POST_ONLY' as const, price: '80638.9', quantity: '0.00013' };

test('delegated gate binds the exact Wallet 1 owner and a live place grant', () => {
  assert.deepEqual(delegatedGate(input, KNOWN_EMBEDDED, true), []);
  assert.match(delegatedGate(input, KNOWN_EMBEDDED, false).join(' '), /placeOrderFor grant/);
  assert.match(delegatedGate({ ...input, owner: EXPECTED_METAMASK }, KNOWN_EMBEDDED, true).join(' '),
    /owner differs/);
});

test('unsigned delegated ABI routes place and cancel to owner-scoped selectors', () => {
  assert.equal(toFunctionSelector(DELEGATED_PLACE_ABI[0]!), '0x80054449');
  assert.equal(toFunctionSelector(DELEGATED_CANCEL_ABI[0]!), '0xe37b444b');
  const call = encodeFunctionData({ abi: DELEGATED_CANCEL_ABI, functionName: 'cancelOrderFor',
    args: [KNOWN_EMBEDDED, 789n] });
  assert.equal(call.slice(0, 10), '0xe37b444b');
  assert.equal(call.slice(34, 74).toLowerCase(), KNOWN_EMBEDDED.slice(2).toLowerCase());
});

test('fresh on-chain open-order read supersedes a stale resting UI row', () => {
  const stale = { owner: KNOWN_EMBEDDED, market: 'BTC-PERP', block: '34789238',
    openOrders: [{ id: '14978756187852164141712' }] };
  const current = { ...stale, block: '34792970', openOrders: [] };
  assert.equal(requireOpenDelegatedOrder(stale, stale.openOrders[0]!.id).id, stale.openOrders[0]!.id);
  assert.throws(() => requireOpenDelegatedOrder(current, stale.openOrders[0]!.id), error =>
    error instanceof OrderNotOpenError && error.code === 'ORDER_NOT_OPEN' &&
    error.block === '34792970' && /no longer open/.test(error.message));
});

test('cancellation guard rejects wrong owner and a different or finished order ID', () => {
  const current = { owner: KNOWN_EMBEDDED, market: 'BTC-PERP', block: '34793000',
    openOrders: [{ id: '123' }] };
  assert.throws(() => requireOpenDelegatedOrder({ ...current, owner: EXPECTED_METAMASK }, '123'),
    /margin owner differs/);
  assert.throws(() => requireOpenDelegatedOrder(current, '124'), OrderNotOpenError);
  assert.equal(requireOpenDelegatedOrder(current, '123').id, '123');
});

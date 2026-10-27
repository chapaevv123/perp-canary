import assert from 'node:assert/strict';
import test from 'node:test';
import type { PerpMarket } from '@somnia-chain/markets-sdk';
import { validateRegistryRow } from '../src/market-registry.ts';

const pool = '0xd6cb1dd58580b84d76068ac21594219ce03aeddf';
const bank = '0x478769E1177C0773c43A593DCCc4Ad15F15F1394';
const collateral = '0xed7993A74dAe1e6656B704A424DcD8711aAf4F72';
const row = { id: pool, poolAddress: pool, marginBank: bank, quoteToken: collateral,
  baseSymbol: 'ETH', quoteSymbol: 'USDso', baseDecimals: 18, quoteDecimals: 18,
  tickSize: '10000000000000000', lotSize: '100000000000000',
  minQuantity: '4000000000000000', initialMarginBps: 500 } as unknown as PerpMarket;
const status = { pool, marginBank: bank, registered: true, restricted: false, tradeable: true };

test('verified market registry preserves per-market precision and exact pool', () => {
  const selected = validateRegistryRow(row, status, collateral);
  assert.equal(selected.symbol, 'ETH-PERP');
  assert.equal(selected.baseDecimals, 18);
  assert.equal(selected.minQuantityRaw, '4000000000000000');
  assert.equal(selected.status, 'TRADEABLE');
});

test('verified market registry rejects mismatched bank and collateral', () => {
  assert.throws(() => validateRegistryRow(row, { ...status, marginBank: pool }, collateral), /mismatch/);
  assert.throws(() => validateRegistryRow(row, status, pool), /mismatch/);
  assert.equal(validateRegistryRow(row, { ...status, restricted: true, tradeable: false }, collateral).status,
    'CLOSE_ONLY');
});

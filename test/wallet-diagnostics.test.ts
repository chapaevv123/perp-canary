import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectWalletArchitecture, walletRoles } from '../src/wallet-diagnostics.ts';

const eoa = '0x1111111111111111111111111111111111111111';
const trading = '0x2222222222222222222222222222222222222222';

test('EOA balance cannot establish a separate dreamDEX trading account', () => {
  const roles = walletRoles(eoa, undefined);
  assert.equal(roles.connectedEoa.status, 'SUPPLIED');
  assert.equal(roles.tradingAccount.status, 'UNKNOWN');
  assert.equal(roles.collateralOwner.status, 'UNKNOWN');
  assert.equal(roles.gasPayer.status, 'UNKNOWN');
});

test('user-supplied trading address is kept distinct from EOA until a link is proven', () => {
  const roles = walletRoles(eoa, trading);
  assert.equal(roles.tradingAccount.value, trading);
  assert.equal(roles.tradingAccount.status, 'SUPPLIED');
  assert.equal(roles.relationship.status, 'UNKNOWN');
});

test('diagnostics rejects private material and malformed transaction hash before network', async () => {
  await assert.rejects(inspectWalletArchitecture({ eoa: 'seed phrase', pool: trading }), /EOA must be an EVM address/);
  await assert.rejects(inspectWalletArchitecture({ eoa, pool: trading, txHash: '0x1234' }), /Transaction hash/);
});

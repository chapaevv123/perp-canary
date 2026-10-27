import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { contractErrorsAbi } from '@somnia-chain/markets-sdk';
import { encodeErrorResult } from 'viem';
import { decodeExecutionError } from '../src/execution-error-decoder.ts';
import { formatExecutionDiagnostic, readExecutionDiagnostics,
  saveExecutionDiagnostic } from '../src/execution-diagnostics.ts';
import type { PreparedPlan } from '../src/delegated-plan.ts';

test('confirmed SDK ABI errors decode through nested viem shapes', () => {
  const errors = [
    ['ImmediateOrCancelNoFill', 'IOC_NO_FILL'],
    ['InsufficientMargin', 'INSUFFICIENT_MARGIN'],
    ['OnlyApprovedContracts', 'PERMISSION_DENIED'],
    ['PriceOutOfBounds', 'PRICE_OUT_OF_BOUNDS'],
    ['InsufficientCollateral', 'INSUFFICIENT_COLLATERAL'],
    ['MaxPositionSizeExceeded', 'MAX_POSITION_SIZE'],
    ['VoucherMarketNotAllowed', 'MARKET_BLOCKED'],
    ['FreshMarketRequired', 'STALE_MARKET'],
    ['PostOnlyWouldCross', 'POST_ONLY_WOULD_CROSS'],
  ] as const;
  for (const [name, reason] of errors) {
    const data = encodeErrorResult({ abi: contractErrorsAbi, errorName: name });
    const decoded = decodeExecutionError({ cause: { cause: { code: 3, data } } }, 'ESTIMATE_GAS');
    assert.equal(decoded.reason, reason);
    assert.equal(decoded.contractError, `${name}()`);
    assert.equal(decoded.selector, data.slice(0, 10));
    assert.equal(decoded.transactionSent, 'NO');
  }
  assert.deepEqual(decodeExecutionError({ name: 'EstimateGasExecutionError',
    cause: { name: 'ContractFunctionRevertedError', data: '0x7cf05fcb' } },
  'ESTIMATE_GAS').nestedCauseNames,
  ['EstimateGasExecutionError', 'ContractFunctionRevertedError']);
});

test('unknown or missing revert data never becomes IOC_NO_FILL', () => {
  const unknown = decodeExecutionError({ cause: { code: 3, data: '0xdeadbeef',
    message: 'execution reverted' } }, 'ESTIMATE_GAS');
  assert.equal(unknown.reason, 'UNKNOWN_REVERT');
  assert.equal(unknown.selector, '0xdeadbeef');
  assert.equal(unknown.contractError, null);
  const missing = decodeExecutionError({ cause: { code: 3, message: 'execution reverted' } }, 'ESTIMATE_GAS');
  assert.equal(missing.reason, 'UNKNOWN_REVERT');
  assert.equal(missing.selector, null);
  assert.equal(decodeExecutionError({ code: -32000, message: 'upstream unavailable' },
    'ESTIMATE_GAS').reason, 'RPC_FAILURE');
});

test('local chain, nonce, expiry and uncertain broadcast remain distinct', () => {
  assert.equal(decodeExecutionError(Error('Wrong chain ID'), 'CHAIN').reason, 'WRONG_CHAIN');
  assert.equal(decodeExecutionError(Error('Nonce conflict'), 'NONCE').reason, 'NONCE_CONFLICT');
  assert.equal(decodeExecutionError(Error('Plan expired'), 'PREFLIGHT').reason, 'PLAN_EXPIRED');
  assert.equal(decodeExecutionError(Error('UNTRUSTED_MARKET_SNAPSHOT: CROSSED_BOOK'),
    'PREFLIGHT').reason, 'UNTRUSTED_MARKET_SNAPSHOT');
  const unknown = decodeExecutionError(Error('timeout'), 'BROADCAST', 'UNKNOWN');
  assert.equal(unknown.reason, 'BROADCAST_UNKNOWN');
  assert.equal(unknown.transactionSent, 'UNKNOWN');
  const receipt = decodeExecutionError({ code: 3, data: '0xd48c4403' }, 'RECEIPT', 'YES');
  assert.equal(receipt.reason, 'IOC_NO_FILL');
  assert.equal(receipt.transactionSent, 'YES');
});

test('diagnostic file is hash-verified and contains no calldata or secret-bearing error text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canary-diagnostic-'));
  const plan = { hash: 'a'.repeat(64), intentId: 'b'.repeat(64), chainId: 50383,
    owner: '0x' + '11'.repeat(20), operator: '0x' + '22'.repeat(20),
    pool: '0x' + '33'.repeat(20), transaction: { to: '0x' + '33'.repeat(20), data: '0x80054449SECRET' },
    side: 'BUY', price: '80000', quantity: '0.00013', expiresAt: new Date().toISOString(),
    sampledBlock: '1', markPriceRaw: '1', risk: { marginBankUnlocked: '1000', estimatedGasUnits: '2000000' },
  } as unknown as PreparedPlan;
  try {
    const decoded = decodeExecutionError({ code: 3, data: '0xdeadbeef',
      message: 'password=never-print-this execution reverted' }, 'ESTIMATE_GAS');
    const record = await saveExecutionDiagnostic(dir, plan, undefined, decoded, 'https://rpc.example');
    assert.match(formatExecutionDiagnostic(record), /Transaction sent: NO/);
    assert.equal((await readExecutionDiagnostics(dir))[0]?.hash, record.hash);
    const file = join(dir, (await readdir(dir))[0]!);
    const content = await readFile(file, 'utf8');
    assert.equal(content.includes('never-print-this'), false);
    assert.equal(content.includes('0x80054449SECRET'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

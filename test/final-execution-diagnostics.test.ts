import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTransaction, type TransactionSerializable } from 'viem';
import { encryptBotKey, withUnlockedBotSigner } from '../src/bot-keystore.ts';
import { BTC_POOL } from '../src/trade-forensics.ts';
import { inspectSignedBotTransaction, inspectSignedFields } from '../src/signed-transaction.ts';
import { classifyPreflightBlockers, finalCheckFailure, FinalExecutionError } from
  '../src/final-execution-diagnostics.ts';
import { dispatchApprovedTransaction } from '../src/delegated-execution.ts';

const fixtureKey = `0x${'11'.repeat(32)}` as const;
const fixturePassword = 'fixture-only-password-2026';
const expected = (): TransactionSerializable => ({ type: 'legacy', chainId: 50383,
  to: BTC_POOL, data: '0x80054449', value: 0n, gas: 3_000_000n,
  gasPrice: 6_000_000_000n, nonce: 4 });

test('fixture keystore unlock, local legacy signature and verifier agree on all signed fields', async () => {
  const keystore = await encryptBotKey(fixtureKey, fixturePassword, 1 << 14);
  const tx = expected();
  const raw = await withUnlockedBotSigner(keystore, fixturePassword,
    signer => signer.signTransaction(tx));
  const parsed = parseTransaction(raw);
  assert.equal(parsed.value, undefined); // viem omits legacy zero; it is still signed as zero.
  assert.deepEqual(await inspectSignedBotTransaction(raw, tx, keystore.address), { passed: true });
  assert.deepEqual(inspectSignedFields(parsed, tx, keystore.address, keystore.address), { passed: true });
  assert.equal((await inspectSignedBotTransaction(raw, tx, BTC_POOL)).passed, false);
});

test('signed field diagnostics distinguish chain, sender, nonce, gas, target, value and calldata', () => {
  const operator = '0x1111111111111111111111111111111111111111';
  const tx = expected();
  const actual = { chainId: 50383, to: BTC_POOL, data: tx.data,
    value: undefined, gas: tx.gas, gasPrice: tx.gasPrice, nonce: tx.nonce };
  const inspect = (changes: Record<string, unknown>, recovered = operator) =>
    inspectSignedFields({ ...actual, ...changes }, tx, operator, recovered);
  assert.deepEqual(inspect({}), { passed: true });
  assert.deepEqual(inspect({ chainId: 1 }),
    { passed: false, stage: 'SIGNATURE_VERIFY', reason: 'CHAIN_ID_MISMATCH' });
  assert.deepEqual(inspect({}, BTC_POOL),
    { passed: false, stage: 'SIGNATURE_VERIFY', reason: 'SENDER_MISMATCH' });
  assert.equal(inspect({ nonce: 5 }).passed, false);
  assert.deepEqual(inspect({ gas: 1n }),
    { passed: false, stage: 'GAS', reason: 'SIGNED_GAS_MISMATCH' });
  assert.deepEqual(inspect({ to: operator }),
    { passed: false, stage: 'CALLDATA', reason: 'SIGNED_TARGET_MISMATCH' });
  assert.deepEqual(inspect({ value: 1n }),
    { passed: false, stage: 'CALLDATA', reason: 'SIGNED_VALUE_MISMATCH' });
  assert.deepEqual(inspect({ data: '0xdeadbeef' }),
    { passed: false, stage: 'CALLDATA', reason: 'SIGNED_CALLDATA_MISMATCH' });
});

test('final preflight diagnostics classify each safety gate without raw RPC or signed bytes', () => {
  const cases = [
    ['Plan expired', 'EXPIRY'], ['Nonce pending or invalid', 'NONCE'],
    ['Gas budget or balance failed', 'GAS'], ['Bot permission revoked or unknown', 'PERMISSIONS'],
    ['Margin, size, precision or SDK preflight failed', 'MARGIN'],
    ['Fresh calldata mismatch', 'CALLDATA'], ['PostOnly would cross current book', 'MARKET'],
  ] as const;
  for (const [message, stage] of cases)
    assert.equal(classifyPreflightBlockers([message]).stage, stage);
  assert.equal(classifyPreflightBlockers(['PostOnly would cross current book']).reason,
    'POST_ONLY_WOULD_CROSS');
  const tx = expected();
  const check = { passed: true, blockers: [], nonce: 5, gasPriceWei: '6000000000',
    gasBalanceWei: '1000000000000000000' } as unknown as Parameters<typeof finalCheckFailure>[0];
  assert.equal(finalCheckFailure(check, tx)?.stage, 'NONCE');
  assert.equal(finalCheckFailure({ ...check, nonce: 4, gasPriceWei: '7000000000' }, tx)?.stage, 'GAS');
});

test('structured signature and keystore failures stop before broadcast', async () => {
  const root = await mkdtemp(join(tmpdir(), 'perp-final-diagnostic-'));
  try {
    let sent = 0;
    const base = { planHash: 'a'.repeat(64), operator: '0x1111111111111111111111111111111111111111',
      pool: BTC_POOL, data: '0x80054449' as const, gasLimit: '3000000',
      gasPriceWei: '6000000000', nonce: 4 };
    const finish = async () => null;
    const denied = await dispatchApprovedTransaction({ ...base, intentId: 'b'.repeat(64) }, {
      sign: async () => '0x02abcd',
      verifySigned: async () => ({ passed: false, stage: 'SIGNATURE_VERIFY', reason: 'SENDER_MISMATCH' }),
      broadcastOnce: async () => { sent++; throw Error('must not send'); },
    }, join(root, 'verification'), finish);
    assert.equal(denied.state, 'BLOCKED');
    assert.deepEqual(denied.diagnostic,
      { passed: false, stage: 'SIGNATURE_VERIFY', reason: 'SENDER_MISMATCH' });
    const keyDenied = await dispatchApprovedTransaction({ ...base, intentId: 'c'.repeat(64) }, {
      sign: async () => { throw new FinalExecutionError('KEYSTORE_UNLOCK', 'PASSWORD_OR_KEYSTORE_INVALID'); },
      verifySigned: async () => true,
      broadcastOnce: async () => { sent++; throw Error('must not send'); },
    }, join(root, 'keystore'), finish);
    assert.equal(keyDenied.diagnostic?.stage, 'KEYSTORE_UNLOCK');
    assert.equal(sent, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

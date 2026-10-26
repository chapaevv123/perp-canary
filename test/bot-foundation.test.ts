import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { encryptBotKey, readBotKeystore, saveBotKeystore, unlockBotAddress, validateKeystore } from '../src/bot-keystore.ts';
import { buildBotExecutionPlan, broadcastBotPlan, IntentReservations, signBotPlan, summarizeConnection } from '../src/bot-foundation.ts';
import { appendBotPlanEvidence, readBotPlanEvidence } from '../src/bot-evidence.ts';
import { localRequestRejection } from '../src/server-security.ts';
import { canonicalBotAddress, comparePublicAddresses } from '../src/bot-address.ts';
import { getAddress, isAddress } from 'viem';

const fixtureKey = `0x${'11'.repeat(32)}` as const;
const password = 'fixture-only-password-2026';
type Observation = NonNullable<Parameters<typeof summarizeConnection>[1]>;
const observation = (changes: Record<string, unknown> = {}): Observation => ({
  chainId: 50383, observedAt: new Date().toISOString(), sampledBlock: '123',
  candidateOperator: '0x1111111111111111111111111111111111111111',
  tradingWallet: '0x2222222222222222222222222222222222222222',
  pool: '0x3333333333333333333333333333333333333333', market: 'BTC-PERP',
  marketSupported: { status: 'SUPPORTED' }, registryMatches: { status: 'SUPPORTED' },
  permissions: { place: { effective: { status: 'SUPPORTED', value: 'true' } },
    cancel: { effective: { status: 'SUPPORTED', value: 'true' } },
    reduce: { effective: { status: 'SUPPORTED', value: 'true' } } },
  marginBankUnlocked: '1000', operatorGasStt: '1', planBlockers: [],
  simulation: { status: 'SUPPORTED' }, unsigned: { chainId: 50383, expiresAt: new Date(Date.now() + 60_000).toISOString(),
    from: '0x1111111111111111111111111111111111111111', to: '0x3333333333333333333333333333333333333333',
    data: '0x80054449', value: '0' }, ...changes,
}) as unknown as Observation;

test('missing keystore is NOT_CONFIGURED and no real key is generated', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canary-bot-'));
  try { assert.equal(await readBotKeystore(join(dir, 'absent.keystore')), null);
    assert.equal(summarizeConnection(null).status, 'NOT_CONFIGURED'); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

test('fixture private key is encrypted; wrong password, tampering and wrong chain fail closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canary-bot-'));
  const path = join(dir, 'fixture.keystore');
  try {
    const data = await encryptBotKey(fixtureKey, password, 1 << 14);
    await saveBotKeystore(data, path);
    const onDisk = await readFile(path, 'utf8');
    assert.equal(onDisk.includes(fixtureKey.slice(2)), false);
    assert.equal((await unlockBotAddress(await readBotKeystore(path), password)).toLowerCase(), data.address.toLowerCase());
    await assert.rejects(unlockBotAddress(data, 'wrong-fixture-password'), /incorrect or keystore corrupted/);
    await assert.rejects(unlockBotAddress({ ...data, crypto: { ...data.crypto, tag: '00'.repeat(16) } }, password),
      /incorrect or keystore corrupted/);
    assert.throws(() => validateKeystore({ ...data, chainId: 1 }), /Invalid bot keystore/);
    await assert.rejects(saveBotKeystore(data, path), /EEXIST/);
    await writeFile(path, '{corrupted');
    await assert.rejects(readBotKeystore(path), /corrupted/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('on-chain permission must be effective; revoked and unknown states never become connected', () => {
  const bot = '0x1111111111111111111111111111111111111111';
  assert.equal(summarizeConnection(bot).status, 'UNKNOWN');
  assert.equal(summarizeConnection(bot, observation()).status, 'ON_CHAIN_LINK_OBSERVED');
  const denied = observation({ permissions: { ...observation().permissions,
    place: { effective: { status: 'BLOCKED', value: 'false' } } } });
  assert.equal(summarizeConnection(bot, denied).status, 'BLOCKED');
  assert.deepEqual(summarizeConnection(bot, denied).allowedMarkets, []);
  assert.equal(summarizeConnection(bot, observation({ chainId: 1 })).status, 'UNKNOWN');
});

test('market, margin, gas, simulation and freshness failures remain blocked', () => {
  const input = { side: 'BUY' as const, price: '80000', quantity: '0.001' };
  for (const changes of [
    { marketSupported: { status: 'BLOCKED' } }, { marginBankUnlocked: 'UNKNOWN' },
    { operatorGasStt: 'UNKNOWN' }, { simulation: { status: 'BLOCKED' } },
    { observedAt: new Date(Date.now() - 31_000).toISOString() },
    { planBlockers: ['SDK maximum placeable size unavailable or exceeded: voucherBlocked'] },
    { permissions: { ...observation().permissions, place: { effective: { status: 'BLOCKED' } } } },
  ]) {
    const plan = buildBotExecutionPlan(observation(changes), input);
    assert.equal(plan.status, 'BLOCKED');
    assert.ok(plan.blockers.length > 1);
  }
});

test('duplicate intent is rejected and both signing and broadcasting are locked', () => {
  const plan = buildBotExecutionPlan(observation(), { side: 'BUY', price: '80000', quantity: '0.001' });
  const reservations = new IntentReservations();
  reservations.reserve(plan.intentKey);
  assert.throws(() => reservations.reserve(plan.intentKey), /Duplicate intent/);
  assert.throws(signBotPlan, /disabled/);
  assert.throws(broadcastBotPlan, /disabled/);
});

test('bot plan audit trail links records and rejects mutation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canary-bot-evidence-'));
  try {
    const plan = buildBotExecutionPlan(observation(), { side: 'BUY', price: '80000', quantity: '0.001' });
    const first = await appendBotPlanEvidence(dir, plan);
    const second = await appendBotPlanEvidence(dir, plan);
    assert.equal(second.previousHash, first.hash);
    assert.equal((await readBotPlanEvidence(dir)).length, 2);
    const files = (await import('node:fs/promises')).readdir;
    const names = await files(dir);
    const path = join(dir, names.sort()[0]!);
    const data = JSON.parse(await readFile(path, 'utf8'));
    data.plan.price = '99999';
    await writeFile(path, JSON.stringify(data));
    await assert.rejects(readBotPlanEvidence(dir), /invalid/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('localhost control rejects DNS rebinding and cross-origin POST requests', () => {
  assert.match(localRequestRejection({ host: 'attacker.example:8787', method: 'GET' }, 8787)!, /Host/);
  assert.match(localRequestRejection({ host: 'localhost:8787', origin: 'https://attacker.example',
    method: 'POST' }, 8787)!, /Same-origin/);
  assert.match(localRequestRejection({ host: 'localhost:8787', fetchSite: 'cross-site',
    method: 'GET' }, 8787)!, /Cross-site/);
  assert.equal(localRequestRejection({ host: 'localhost:8787', origin: 'http://localhost:8787',
    method: 'POST' }, 8787), null);
});

test('browser and HTTP control code contain no password input or signing endpoint', async () => {
  for (const path of ['web/bot.js', 'src/server.ts']) {
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /eth_sendTransaction|eth_sendRawTransaction|signTransaction|unlockBotAddress|generatePrivateKey/);
  }
});

test('bot address command uses canonical EIP-55 public metadata', () => {
  const stored = '0xA8ad1E44f4D74EF1fCDf479A97D54e6Bdf6fBE36';
  assert.equal(stored.length, 42);
  assert.equal(isAddress(stored), true);
  assert.equal(canonicalBotAddress(stored), getAddress(stored));
  assert.equal(canonicalBotAddress(stored.toLowerCase()), stored);
  assert.throws(() => canonicalBotAddress(`${stored}\u200b`), /plain 42-character/);
});

test('reported pasted address differs by a hex digit, beyond checksum case', () => {
  const stored = '0xA8ad1E44f4D74EF1fCDf479A97D54e6Bdf6fBE36';
  const pasted = '0xA8ad1E44F4D74EF1fCDf479A97D54e6Bdf6F6E36';
  const result = comparePublicAddresses(pasted, stored);
  assert.equal(result.exactLength, true);
  assert.equal(result.plainHex, true);
  assert.equal(result.viemStrict, false);
  assert.equal(result.viemNonStrict, true);
  assert.equal(result.sameAddressIgnoringCase, false);
  assert.deepEqual(result.differences.filter(diff => !diff.caseOnly),
    [{ position: 39, entered: '6', expected: 'B', caseOnly: false }]);
  assert.notEqual(getAddress(pasted), stored);
});

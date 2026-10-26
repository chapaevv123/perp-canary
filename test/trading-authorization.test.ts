import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { decideAuthorization, SELECTORS } from '../src/trading-authorization.ts';
import { verifyAuthorizationArtifact, type AuthorizationArtifact } from '../src/authorization-evidence.ts';

const now = Date.now();
const base = { chainId: 50383, marketSupported: true, registryMatches: true,
  placeAuthorized: true, gasWei: 10n, requiredGasWei: 5n, sufficientMargin: true,
  signerControlled: false, asOf: now, now, simulation: true, walletMatches: true };
const decide = (changes: Partial<Parameters<typeof decideAuthorization>[0]> = {}) => decideAuthorization({ ...base, ...changes });

test('official selectors remain independent', () => {
  assert.deepEqual(SELECTORS, { place: '0x80054449', cancel: '0xe37b444b', reduce: '0x364c2587' });
});
test('unauthorized EOA and missing delegate are blocked', () => {
  assert.match(decide({ placeAuthorized: false }).blockers.join(' '), /No effective placeOrderFor/);
  assert.equal(decide({ placeAuthorized: null }).status, 'BLOCKED');
});
test('wrong chain is blocked', () => assert.match(decide({ chainId: 50312 }).blockers.join(' '), /Wrong chain/));
test('expired local preflight is blocked', () => assert.match(decide({ asOf: now - 31_000 }).blockers.join(' '), /stale/));
test('unsupported market is blocked', () => assert.match(decide({ marketSupported: false }).blockers.join(' '), /Unsupported market/));
test('unavailable market read is not misreported as unsupported', () => {
  assert.doesNotMatch(decide({ marketSupported: null }).blockers.join(' '), /Unsupported market/);
});
test('insufficient collateral is blocked', () => assert.match(decide({ sufficientMargin: false }).blockers.join(' '), /Insufficient/));
test('insufficient gas is blocked', () => assert.match(decide({ gasWei: 4n }).blockers.join(' '), /STT/));
test('mismatched wallet is blocked', () => assert.match(decide({ walletMatches: false }).blockers.join(' '), /Trading wallet differs/));
test('failed simulation is blocked', () => assert.match(decide({ simulation: false }).blockers.join(' '), /simulation failed/));
test('wrong registry is blocked', () => assert.match(decide({ registryMatches: false }).blockers.join(' '), /registry differs/));
test('no signature or broadcast exists even when all reads pass', () => {
  const result = decide();
  assert.equal(result.status, 'BLOCKED');
  assert.match(result.blockers.join(' '), /no authorized signer or broadcast/);
});
test('production M2.6 controllers contain no send or sign request', async () => {
  for (const path of ['web/wallet.js', 'web/authorization.js', 'src/trading-authorization.ts']) {
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /eth_sendTransaction|eth_sendRawTransaction|personal_sign|signMessage|signTransaction/);
  }
});

test('LIVE authorization artifact detects tampering and a mismatched block filename', async () => {
  const name = 'authorization-33989411.json';
  const artifact = JSON.parse(await readFile(`authorization-evidence/${name}`, 'utf8')) as AuthorizationArtifact;
  assert.doesNotThrow(() => verifyAuthorizationArtifact(artifact, name));
  assert.throws(() => verifyAuthorizationArtifact(artifact, 'authorization-1.json'), /filename mismatch/);
  assert.throws(() => verifyAuthorizationArtifact({ ...artifact, operatorGasStt: '1000' }, name), /invalid/);
});

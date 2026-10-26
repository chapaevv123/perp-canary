import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendSnapshot, evaluateFeed, readSnapshots, seal, verify, type SnapshotBody } from '../src/evidence.ts';

const body: SnapshotBody = { schema: 'perp-canary/snapshot/v1', mode: 'LIVE', observedAt: '2026-10-26T00:00:00.000Z',
  chainId: 50383, blockNumber: '1', blockHash: `0x${'a'.repeat(64)}`, blockTimestamp: '1',
  sources: { sdk: 'sdk', rpc: 'rpc', indexer: 'indexer' }, sdkVersion: '0.32.1', markets: [],
  systemConfig: {}, previousHash: null, limitations: [] };

test('hash chain accepts linked snapshots and rejects mutation', () => {
  const first = seal(body);
  const second = seal({ ...body, blockNumber: '2', previousHash: first.hash });
  verify([first, second]);
  assert.throws(() => verify([{ ...first, blockNumber: '3' }]), /Hash mismatch/);
  assert.throws(() => verify([second]), /Chain break/);
});

test('feed gate never grants green for missing or zero data', () => {
  assert.equal(evaluateFeed(null).gate, 'UNKNOWN');
  assert.equal(evaluateFeed({ markPriceOk: true, markPrice: '0' }).gate, 'RED');
  assert.equal(evaluateFeed({ markPriceOk: false, markPrice: '100' }).gate, 'RED');
  assert.equal(evaluateFeed({ markPriceOk: true, markPrice: '100' }).gate, 'AMBER');
  assert.equal(evaluateFeed({ markPriceOk: true, markPrice: '100', indexUpdatedAt: '1' }).gate, 'GREEN');
});

test('repeated writes link, and corrupt persisted data fails closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'perp-canary-'));
  try {
    const withoutLink: Omit<SnapshotBody, 'previousHash'> = {
      schema: body.schema, mode: body.mode, observedAt: body.observedAt,
      chainId: body.chainId, blockNumber: body.blockNumber, blockHash: body.blockHash,
      blockTimestamp: body.blockTimestamp, sources: body.sources, sdkVersion: body.sdkVersion,
      systemConfig: body.systemConfig, markets: body.markets, limitations: body.limitations,
    };
    await appendSnapshot(dir, withoutLink);
    await appendSnapshot(dir, { ...withoutLink, blockNumber: '2' });
    const files = (await readdir(dir)).sort();
    assert.equal(files.length, 2);
    const snapshots = await readSnapshots(dir);
    assert.equal(snapshots[1]?.previousHash, snapshots[0]?.hash);
    const path = join(dir, files[0]!);
    const changed = (await readFile(path, 'utf8')).replace('"blockNumber":"1"', '"blockNumber":"9"');
    await writeFile(path, changed);
    await assert.rejects(readSnapshots(dir), /Hash mismatch/);
    await assert.rejects(appendSnapshot(dir, withoutLink), /Hash mismatch/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

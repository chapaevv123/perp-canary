import assert from 'node:assert/strict';
import test from 'node:test';
import { withSnapshotSdk } from '../src/lifecycle.ts';

test('snapshot SDK closes after a successful read', async () => {
  let closes = 0;
  const result = await withSnapshotSdk({ close: async () => { closes++; } }, new AbortController(),
    async () => 'snapshot', () => 'test', 100);
  assert.equal(result, 'snapshot');
  assert.equal(closes, 1);
});

test('snapshot SDK closes after a read failure', async () => {
  let closes = 0;
  await assert.rejects(withSnapshotSdk({ close: async () => { closes++; } }, new AbortController(),
    async () => { throw new Error('read failed'); }, () => 'test', 100), /read failed/);
  assert.equal(closes, 1);
});

test('stalled read reports its phase, aborts, and closes the SDK', async () => {
  let closes = 0;
  const controller = new AbortController();
  await assert.rejects(withSnapshotSdk({ close: async () => { closes++; } }, controller,
    async () => new Promise<never>(() => {}), () => 'reading BTC feed', 10),
  /timed out after 10 ms during reading BTC feed/);
  assert.equal(controller.signal.aborted, true);
  assert.equal(closes, 1);
});

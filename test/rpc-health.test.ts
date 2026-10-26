import assert from 'node:assert/strict';
import test from 'node:test';
import { isTimeout, PreflightError } from '../src/rpc-health.ts';

test('nested SDK timeout is classified without returning its raw RPC error', () => {
  const sdkError = new Error('rpc getBlockNumber failed', { cause: new Error('The request took too long to respond') });
  assert.equal(isTimeout(sdkError), true);
  assert.equal(isTimeout(new Error('Contract reverted')), false);
  const diagnostic = new PreflightError('RPC_TIMEOUT', 'reading position', 'WSS', 2);
  assert.equal(diagnostic.message, 'RPC_TIMEOUT during reading position via WSS after 2 read attempt(s)');
});

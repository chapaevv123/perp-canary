import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceError } from '../src/source-health.ts';

test('source health separates sandbox permission, DNS, timeout and chain mismatch', () => {
  const denied = Object.assign(new Error('connect failed'), { code: 'EACCES' });
  assert.equal(sourceError(new AggregateError([denied], 'fetch failed')).code, 'NETWORK_PERMISSION');
  assert.equal(sourceError(Object.assign(new Error('getaddrinfo'), { cause: { code: 'ENOTFOUND' } })).code, 'DNS');
  assert.equal(sourceError(new Error('read timed out')).code, 'TIMEOUT');
  assert.equal(sourceError(new Error('genesis check failed')).code, 'SDK_GENESIS_CHECK');
  assert.equal(sourceError(new Error('wrong chain id')).code, 'CHAIN_MISMATCH');
  assert.equal(sourceError(new Error('unexpected response')).code, 'SOURCE_ERROR');
});

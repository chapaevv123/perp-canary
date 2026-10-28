import assert from 'node:assert/strict';
import test from 'node:test';
import { TradeStageError, tradeStage } from '../src/trade-stage.ts';

test('RPC timeout identifies the read-only stage without echoing upstream payload', async () => {
  const upstream = new Error('RPC timed out; secret upstream URL https://private.example/key');
  await assert.rejects(tradeStage('direct wallet margin preview', async () => { throw upstream; }), error => {
    assert.ok(error instanceof TradeStageError);
    assert.equal(error.phase, 'direct wallet margin preview');
    assert.equal(error.code, 'READ_TIMEOUT');
    assert.equal(error.retryable, true);
    assert.doesNotMatch(error.message, /private\.example|secret upstream URL/);
    assert.match(error.message, /No transaction was requested/);
    return true;
  });
});

test('verified deployment mismatch is deterministic and must not advertise transient retry', async () => {
  await assert.rejects(tradeStage('pool MarginBank address', async () => {
    throw Error('Pool MarginBank mismatch');
  }), error => {
    assert.ok(error instanceof TradeStageError);
    assert.equal(error.code, 'VERIFICATION_FAILED');
    assert.equal(error.retryable, false);
    return true;
  });
});

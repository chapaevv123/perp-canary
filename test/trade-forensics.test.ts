import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { analyzeTrade, collectTradeForensics, OWNER_TRADING_WALLET, OWNER_TX,
  type RawBlock, type RawReceipt, type RawTx, type TradeSource } from '../src/trade-forensics.ts';
import { verifyTradeArtifact, type TradeArtifact } from '../src/trade-evidence.ts';
import { NETWORK_REGISTRY } from '../src/network-registry.ts';

const artifact = JSON.parse(await readFile(`trade-evidence/tx-${OWNER_TX.slice(2)}.json`, 'utf8')) as TradeArtifact;
const source: TradeSource = { chainId: artifact.chainId!, tx: artifact.transaction as RawTx,
  receipt: artifact.receipt as RawReceipt, block: artifact.block as RawBlock };
const input = { txHash: OWNER_TX, tradingWallet: OWNER_TRADING_WALLET, marketIdentity: artifact.marketIdentity };

test('actual official-ABI event fixture verifies the executed BTC-PERP long', () => {
  verifyTradeArtifact(artifact);
  const result = analyzeTrade(source, artifact.networkLookups, { ...input, trace: artifact.internalCalls.trace });
  assert.equal(result.evidenceConfidence, 'VERIFIED');
  assert.equal(result.decodedCall?.method, 'placeOrderFor');
  assert.equal(result.decodedCall?.orderType, 2);
  assert.equal(result.positionReconciliation.filledQuantity, '0.05416');
  assert.deepEqual(result.positionReconciliation.fillPrices, ['80043.8']);
  assert.equal(result.walletAttribution.senderIsTradingWallet, false);
  assert.equal(result.uiComparison.initialMargin216_22, 'UNKNOWN');
  assert.equal(result.internalCalls.status, 'PARTIALLY_VERIFIED');
});

test('missing transaction is UNKNOWN and wrong network is MISMATCH', () => {
  assert.equal(analyzeTrade(null, artifact.networkLookups, input).evidenceConfidence, 'UNKNOWN');
  assert.equal(analyzeTrade({ ...source, chainId: 50312 }, artifact.networkLookups, input).evidenceConfidence, 'MISMATCH');
});

test('reverted transaction and wrong trading wallet are MISMATCH', () => {
  const reverted = analyzeTrade({ ...source, receipt: { ...source.receipt, status: '0x0' } }, artifact.networkLookups, input);
  assert.equal(reverted.evidenceConfidence, 'MISMATCH');
  const wrongWallet = analyzeTrade(source, artifact.networkLookups,
    { ...input, tradingWallet: '0x1111111111111111111111111111111111111111' });
  assert.equal(wrongWallet.evidenceConfidence, 'MISMATCH');
});

test('successful receipt without logs proves no filled trade', () => {
  const noLogs = analyzeTrade({ ...source, receipt: { ...source.receipt, logs: [] } }, artifact.networkLookups, input);
  assert.equal(noLogs.evidenceConfidence, 'PARTIALLY_VERIFIED');
  assert.equal(noLogs.positionReconciliation.status, 'UNKNOWN');
  const unrelated = analyzeTrade({ ...source, tx: { ...source.tx, to: '0x1111111111111111111111111111111111111111' },
    receipt: { ...source.receipt, logs: [] } }, artifact.networkLookups, input);
  assert.equal(unrelated.evidenceConfidence, 'MISMATCH');
  const inconsistentReceipt = analyzeTrade({ ...source, receipt: { ...source.receipt,
    from: '0x1111111111111111111111111111111111111111' } }, artifact.networkLookups, input);
  assert.equal(inconsistentReceipt.evidenceConfidence, 'MISMATCH');
});

test('chain-ID mismatch and absent tx stop read-only collector safely', async () => {
  const calls: string[] = [];
  const missing = await collectTradeForensics(input, async (url, method) => {
    calls.push(method);
    if (method === 'eth_chainId') {
      const network = NETWORK_REGISTRY.find(row => row.rpc === url)!;
      return network.chainId === 50383 ? '0x1' : `0x${network.chainId.toString(16)}`;
    }
    return null;
  });
  assert.equal(missing.evidenceConfidence, 'UNKNOWN');
  assert.equal(missing.networkLookups[0]?.status, 'WRONG_CHAIN_ID');
  assert.equal(calls.filter(method => method === 'eth_getTransactionByHash').length, 2);
});

test('SHA-256 trade artifact rejects tampering without touching M0/M1 chains', () => {
  assert.throws(() => verifyTradeArtifact({ ...artifact, evidenceConfidence: 'MISMATCH' }), /hash invalid/);
});

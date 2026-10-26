import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

async function harness(chain: number, confirm: boolean, failPlanNumber = 0) {
  const calls: string[] = [];
  const sent: unknown[] = [];
  const nodes = new Map<string, Record<string, unknown>>();
  const node = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', hidden: false, textContent: '', className: '', disabled: false,
      replaceChildren() { /* fake DOM */ }, append() { /* fake DOM */ },
    });
    return nodes.get(id)!;
  };
  Object.assign(node('operation'), { value: 'PLACE' });
  Object.assign(node('pool'), { value: '0x2222222222222222222222222222222222222222' });
  Object.assign(node('side'), { value: 'buy' });
  Object.assign(node('price'), { value: '80000' });
  Object.assign(node('quantity'), { value: '0.001' });
  const account = '0x1111111111111111111111111111111111111111';
  const provider = { isMetaMask: true, on() { /* event hook */ }, async request(args: { method: string; params?: unknown[] }) {
    calls.push(args.method);
    if (args.method === 'eth_requestAccounts') return [account];
    if (args.method === 'eth_chainId') return '0x' + chain.toString(16);
    if (args.method === 'eth_sendTransaction') { sent.push(args.params?.[0]); return '0x' + 'a'.repeat(64); }
    throw new Error('Unexpected wallet method');
  } };
  const plan = { operation: 'PLACE', account, pool: node('pool').value, symbol: 'BTC-PERP',
    baseline: { blockNumber: '1' }, blockers: [], request: {}, warnings: [], preview: {},
    wallet: { whitelist: 'NOT_VERIFIED', gasLimit: '10000000', estimatedGasCostWei: '1000' },
    unsigned: { chainId: 50383, to: node('pool').value, value: '0', data: '0x12345678' } };
  let plans = 0;
  const context = { document: { getElementById: node, createElement: () => ({ value: '', textContent: '' }) },
    window: { ethereum: provider, addEventListener() { /* EIP-6963 */ }, dispatchEvent() { /* EIP-6963 */ },
      confirm: () => confirm }, Event: class {}, setTimeout: (callback: () => void) => callback(),
    fetch: async (path: string) => {
      if (path === '/api/v1/plan') {
        plans++;
        if (plans === failPlanNumber) return { ok: false, json: async () => ({ code: 'RPC_TIMEOUT',
          error: 'RPC_TIMEOUT during reading position via WSS after 2 read attempt(s)' }) };
        return { ok: true, json: async () => ({ state: 'DRY_RUN_READY', hash: 'hash-' + plans, payload: plan }) };
      }
      return { ok: true, json: async () => ({ payload: { assessment: { verdict: 'GREEN', reasons: [] } }, hash: 'record' }) };
    }, loadRecords: async () => undefined, showComparison: () => undefined };
  const code = await readFile(join('web', 'wallet.js'), 'utf8');
  runInNewContext(code, context);
  return { node, calls, sent };
}

test('browser wallet never sends automatically or after owner cancels', async () => {
  const app = await harness(50383, false);
  assert.equal(app.calls.includes('eth_sendTransaction'), false);
  await (app.node('connectWallet').onclick as () => Promise<void>)();
  await (app.node('planForm').onsubmit as (event: { preventDefault(): void }) => Promise<void>)({ preventDefault() {} });
  assert.equal(app.node('reviewWallet').hidden, true);
  await (app.node('reviewWallet').onclick as () => Promise<void>)();
  assert.equal(app.calls.includes('eth_sendTransaction'), false);
});

test('wrong wallet network prevents a send-ready plan', async () => {
  const app = await harness(1, true);
  await (app.node('connectWallet').onclick as () => Promise<void>)();
  assert.equal(app.node('reviewWallet').hidden, true);
  assert.equal(app.calls.includes('eth_sendTransaction'), false);
});

test('even explicit owner approval cannot trigger a transaction in M2.6', async () => {
  const app = await harness(50383, true);
  await (app.node('connectWallet').onclick as () => Promise<void>)();
  await (app.node('planForm').onsubmit as (event: { preventDefault(): void }) => Promise<void>)({ preventDefault() {} });
  await (app.node('reviewWallet').onclick as () => Promise<void>)();
  assert.equal(app.calls.filter(call => call === 'eth_sendTransaction').length, 0);
  assert.equal(app.sent.length, 0);
  assert.match(String(app.node('sendState').textContent), /execution lock/i);
});

test('timeout on fresh preflight removes wallet review and makes no send request', async () => {
  const app = await harness(50383, true, 2);
  await (app.node('connectWallet').onclick as () => Promise<void>)();
  await (app.node('planForm').onsubmit as (event: { preventDefault(): void }) => Promise<void>)({ preventDefault() {} });
  assert.equal(app.node('reviewWallet').hidden, true);
  await (app.node('reviewWallet').onclick as () => Promise<void>)();
  assert.equal(app.node('reviewWallet').hidden, true);
  assert.match(String(app.node('sendState').textContent), /execution lock/i);
  assert.equal(app.calls.includes('eth_sendTransaction'), false);
});

test('invalid input is rejected before network preflight', async () => {
  const app = await harness(50383, true);
  Object.assign(app.node('account'), { value: 'not an address' });
  await (app.node('planForm').onsubmit as (event: { preventDefault(): void }) => Promise<void>)({ preventDefault() {} });
  assert.match(String(app.node('planOutput').textContent), /PREFLIGHT FAILED/);
  assert.equal(app.node('reviewWallet').hidden, true);
});

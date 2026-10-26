import assert from 'node:assert/strict';
import test from 'node:test';
import { NETWORK_REGISTRY } from '../src/network-registry.ts';
import { probeIsFresh, probeNetwork, rpcRead, RpcProbeError, type RpcRead } from '../src/network-probe.ts';
import { assessFunding, compareUiAmount, fundingRoutes } from '../src/funding-intelligence.ts';

const eoa = '0x1111111111111111111111111111111111111111';
const trading = '0x2222222222222222222222222222222222222222';
const hideki = NETWORK_REGISTRY.find(network => network.chainId === 50383)!;
const shannon = NETWORK_REGISTRY.find(network => network.chainId === 50312)!;

function mockRpc(chainId: number, balances: Record<string, bigint> = {}): RpcRead {
  return async (_url, method, params) => {
    if (method === 'eth_chainId') return `0x${chainId.toString(16)}`;
    if (method === 'eth_blockNumber') return '0x10';
    if (method === 'eth_getCode') return '0x6000';
    if (method === 'eth_getBalance') return `0x${(balances[String(params[0]).toLowerCase()] ?? 0n).toString(16)}`;
    if (method === 'eth_call') return '0x0';
    throw Error('unexpected read');
  };
}

test('registry keeps verified networks and native symbols separate', () => {
  assert.deepEqual(NETWORK_REGISTRY.map(network => network.chainId), [50383, 50312, 5031]);
  assert.equal(shannon.tokenMetadata[0]?.symbol, 'STT');
  assert.equal(NETWORK_REGISTRY[2]?.tokenMetadata[0]?.symbol, 'SOMI');
  assert.equal(NETWORK_REGISTRY[2]?.verifiedContractAddresses.marginBank, undefined);
});

test('wrong chain ID stops before all balance reads', async () => {
  let calls = 0;
  const probe = await probeNetwork(hideki, { eoa, tradingAccount: trading }, async (_url, method) => {
    calls++; assert.equal(method, 'eth_chainId'); return '0xc488';
  });
  assert.equal(probe.status, 'UNSUPPORTED');
  assert.equal(probe.errorCode, 'WRONG_CHAIN_ID');
  assert.equal(probe.accounts.length, 0);
  assert.equal(calls, 1);
});

test('different addresses and networks retain independent balances', async () => {
  const shannonProbe = await probeNetwork(shannon, { eoa, tradingAccount: trading }, mockRpc(50312,
    { [eoa.toLowerCase()]: 26_306836931197556435n, [trading.toLowerCase()]: 0n }));
  const hidekiProbe = await probeNetwork(hideki, { eoa, tradingAccount: trading }, mockRpc(50383,
    { [eoa.toLowerCase()]: 0n, [trading.toLowerCase()]: 19_312000000000000000n }));
  assert.equal(shannonProbe.accounts[0]?.native.value, '26.306836931197556435');
  assert.equal(shannonProbe.accounts[1]?.native.value, '0');
  assert.equal(hidekiProbe.accounts[0]?.native.value, '0');
  assert.equal(hidekiProbe.accounts[1]?.native.value, '19.312');
  assert.equal(compareUiAmount('26.306836', 'SOMI', [shannonProbe]).matched?.nativeSymbol, 'STT');
  assert.equal(compareUiAmount('2', 'SOMI', [shannonProbe]).status, 'UNVERIFIED');
});

test('RPC timeout and bad RPC never produce a zero balance', async () => {
  const timeout = await probeNetwork(hideki, { eoa }, async () => { throw new RpcProbeError('TIMEOUT'); });
  assert.equal(timeout.status, 'RPC_ERROR');
  assert.equal(timeout.errorCode, 'TIMEOUT');
  assert.deepEqual(timeout.accounts, []);
  const failedBalance = await probeNetwork(hideki, { eoa }, async (url, method, params) => {
    if (method === 'eth_getBalance') throw new RpcProbeError('RPC_ERROR');
    return mockRpc(50383)(url, method, params);
  });
  assert.equal(failedBalance.accounts[0]?.native.status, 'RPC_ERROR');
  assert.equal(failedBalance.accounts[0]?.native.value, null);
});

test('missing ERC-20 code is unsupported while unknown token is not invented', async () => {
  const probe = await probeNetwork(hideki, { eoa }, async (url, method, params) =>
    method === 'eth_getCode' ? '0x' : mockRpc(50383)(url, method, params));
  assert.equal(probe.accounts[0]?.erc20.USDso?.status, 'UNSUPPORTED');
  assert.equal(probe.accounts[0]?.erc20.SOMI, undefined);
});

test('bad RPC Content-Type and timeout fail safely before JSON parsing', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, headers: { get: () => 'text/html' },
      json: () => { throw Error('must not parse'); } }) as unknown as Response;
    await assert.rejects(rpcRead('https://rpc.invalid', 'eth_chainId', []),
      (error: unknown) => error instanceof RpcProbeError && error.code === 'RPC_ERROR');
  } finally { globalThis.fetch = original; }
});

test('stale sample, missing collateral and unverified relationship cannot produce READY', async () => {
  const probe = await probeNetwork(hideki, { eoa, tradingAccount: trading }, mockRpc(50383,
    { [trading.toLowerCase()]: 19_312000000000000000n }));
  assert.equal(probeIsFresh(probe, Date.parse(probe.observedAt) + 121_000), false);
  assert.equal(assessFunding([probe], null, trading, Date.now()).status, 'UNKNOWN');
  assert.equal(assessFunding([probe], null, trading, Date.parse(probe.observedAt) + 121_000).status, 'UNKNOWN');
  const diagnostics = { accounts: [{ role: 'TRADING_ACCOUNT', address: trading,
    marginBankUnlocked: { status: 'CONFIRMED', value: '0' } }] } as unknown as Parameters<typeof assessFunding>[1];
  const blocked = assessFunding([probe], diagnostics, trading, Date.parse(probe.observedAt) + 1);
  assert.equal(blocked.status, 'BLOCKED');
  assert.match(blocked.nextAction, /No deposit is inferred/);
  const funded = { accounts: [{ role: 'TRADING_ACCOUNT', address: trading,
    marginBankUnlocked: { status: 'CONFIRMED', value: '1000' },
    voucherFloor: { status: 'CONFIRMED', value: '1000' } }] } as unknown as Parameters<typeof assessFunding>[1];
  const pending = assessFunding([probe], funded, trading, Date.parse(probe.observedAt) + 1);
  assert.equal(pending.status, 'UNKNOWN');
  assert.match(pending.reasons[0]!, /paper-credit market restrictions/);
  const routes = fundingRoutes(null, null);
  assert.equal(routes.find(route => route.id === 'dreamdex-deposit')?.availability, 'UNKNOWN');
  assert.equal(routes.find(route => route.id === 'sdk-test-bridge')?.availability, 'UNKNOWN');
});

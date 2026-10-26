import { formatUnits, getAddress, isAddress } from 'viem';
import type { NetworkConfig } from './network-registry.ts';

export type ProbeStatus = 'READY' | 'BLOCKED' | 'UNKNOWN' | 'RPC_ERROR' | 'UNSUPPORTED';
export type BalanceFact = { status: ProbeStatus; value: string | null; raw: string | null; source: string };
export type AccountProbe = { role: 'LOGIN_WALLET' | 'TRADING_WALLET'; address: string;
  native: BalanceFact; erc20: Record<string, BalanceFact> };
export type NetworkProbe = { name: string; chainId: number; rpc: string; status: ProbeStatus;
  observedChainId: number | null; blockNumber: string | null; observedAt: string; accounts: AccountProbe[];
  errorCode: string | null; provenance: readonly string[] };
export type RpcRead = (url: string, method: string, params: unknown[]) => Promise<unknown>;

export class RpcProbeError extends Error {
  readonly code: 'TIMEOUT' | 'RPC_ERROR';
  constructor(code: 'TIMEOUT' | 'RPC_ERROR') { super(code); this.name = 'RpcProbeError'; this.code = code; }
}

export const rpcRead: RpcRead = async (url, method, params) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: controller.signal });
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json'))
      throw new RpcProbeError('RPC_ERROR');
    const payload = await response.json() as { result?: unknown; error?: unknown };
    if (payload.error || payload.result === undefined) throw new RpcProbeError('RPC_ERROR');
    return payload.result;
  } catch (error) {
    if (error instanceof RpcProbeError) throw error;
    if (controller.signal.aborted) throw new RpcProbeError('TIMEOUT');
    throw new RpcProbeError('RPC_ERROR');
  } finally { clearTimeout(timer); }
};

function hex(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) throw new RpcProbeError('RPC_ERROR');
  return BigInt(value);
}
function errorCode(error: unknown): string { return error instanceof RpcProbeError ? error.code : 'RPC_ERROR'; }
function failed(source: string, status: ProbeStatus = 'RPC_ERROR'): BalanceFact {
  return { status, value: null, raw: null, source };
}
function known(raw: bigint, decimals: number, source: string): BalanceFact {
  return { status: 'READY', value: formatUnits(raw, decimals), raw: raw.toString(), source };
}

export async function probeNetwork(network: NetworkConfig, input: { eoa?: string; tradingAccount?: string },
  read: RpcRead = rpcRead): Promise<NetworkProbe> {
  const addresses: { role: AccountProbe['role']; address: string }[] = [];
  for (const [role, value] of [['LOGIN_WALLET', input.eoa], ['TRADING_WALLET', input.tradingAccount]] as const) {
    if (!value) continue;
    if (!isAddress(value, { strict: false })) throw new Error(`${role} must be a public EVM address`);
    addresses.push({ role, address: getAddress(value) });
  }
  const base = { name: network.name, chainId: network.chainId, rpc: network.rpc,
    observedAt: new Date().toISOString(), provenance: network.provenance };
  let observedChainId: number;
  let blockNumber: string;
  try {
    observedChainId = Number(hex(await read(network.rpc, 'eth_chainId', [])));
    if (observedChainId !== network.chainId) return { ...base, status: 'UNSUPPORTED', observedChainId,
      blockNumber: null, accounts: [], errorCode: 'WRONG_CHAIN_ID' };
    blockNumber = hex(await read(network.rpc, 'eth_blockNumber', [])).toString();
  } catch (error) {
    return { ...base, status: 'RPC_ERROR', observedChainId: null, blockNumber: null,
      accounts: [], errorCode: errorCode(error) };
  }
  const tokenCode = new Map<string, 'PRESENT' | 'ABSENT' | 'RPC_ERROR'>();
  for (const token of network.tokenMetadata) {
    if (!token.address) continue;
    try {
      const code = await read(network.rpc, 'eth_getCode', [token.address, 'latest']);
      tokenCode.set(token.symbol, code === '0x' || code === '0x0' ? 'ABSENT' :
        typeof code === 'string' && /^0x[0-9a-fA-F]+$/.test(code) ? 'PRESENT' : 'RPC_ERROR');
    } catch { tokenCode.set(token.symbol, 'RPC_ERROR'); }
  }
  const accounts: AccountProbe[] = [];
  for (const { role, address } of addresses) {
    let native: BalanceFact;
    try { native = known(hex(await read(network.rpc, 'eth_getBalance', [address, 'latest'])),
      network.tokenMetadata[0]!.decimals, `eth_getBalance; ${network.name}; block sampled ${blockNumber}`); }
    catch { native = failed(`Native balance read failed on ${network.name}`); }
    const erc20: Record<string, BalanceFact> = {};
    for (const token of network.tokenMetadata) {
      if (token.kind !== 'ERC20' || !token.address) continue;
      const state = tokenCode.get(token.symbol);
      if (state === 'ABSENT') { erc20[token.symbol] = failed(`No contract code at verified ${token.symbol} address on ${network.name}`, 'UNSUPPORTED'); continue; }
      if (state !== 'PRESENT') { erc20[token.symbol] = failed(`${token.symbol} contract availability read failed on ${network.name}`); continue; }
      try {
        const data = `0x70a08231${address.slice(2).toLowerCase().padStart(64, '0')}`;
        erc20[token.symbol] = known(hex(await read(network.rpc, 'eth_call', [{ to: token.address, data }, 'latest'])),
          token.decimals, `${token.symbol}.balanceOf(${address}); ${network.name}; block sampled ${blockNumber}`);
      } catch { erc20[token.symbol] = failed(`${token.symbol} balance read failed on ${network.name}`); }
    }
    accounts.push({ role, address, native, erc20 });
  }
  return { ...base, status: 'READY', observedChainId, blockNumber, accounts, errorCode: null };
}

export function probeIsFresh(probe: NetworkProbe, nowMs: number, maxAgeMs = 120_000): boolean {
  const age = nowMs - Date.parse(probe.observedAt);
  return probe.status === 'READY' && Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
}

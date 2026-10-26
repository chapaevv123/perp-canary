import { createPublicClient, http } from 'viem';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';

export const RPC = 'https://api.hideki2.infra.testnet.somnia.network';

export class PreflightError extends Error {
  readonly code: 'RPC_TIMEOUT' | 'RPC_READ_FAILED';
  readonly phase: string;
  readonly transport: 'HTTPS' | 'WSS';
  readonly attempts: number;
  constructor(code: 'RPC_TIMEOUT' | 'RPC_READ_FAILED', phase: string,
    transport: 'HTTPS' | 'WSS', attempts: number) {
    super(`${code} during ${phase} via ${transport} after ${attempts} read attempt(s)`);
    this.name = 'PreflightError';
    this.code = code;
    this.phase = phase;
    this.transport = transport;
    this.attempts = attempts;
  }
}

export function isTimeout(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error && /timeout|timed out|took too long/i.test(`${current.name} ${current.message}`)) return true;
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

export async function readRpcHead(): Promise<{ chainId: number; blockNumber: string }> {
  const client = createPublicClient({ chain: hidekiTestnet,
    transport: http(RPC, { timeout: 15_000, retryCount: 0 }) });
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const chainId = await client.getChainId();
      if (chainId !== 50383) throw new Error(`Wrong chain ID ${chainId}`);
      return { chainId, blockNumber: (await client.getBlockNumber()).toString() };
    } catch (error) {
      if (isTimeout(error)) {
        if (attempt === 1) continue;
        throw new PreflightError('RPC_TIMEOUT', 'checking Hideki chain and block', 'HTTPS', attempt);
      }
      if (error instanceof Error && error.message.startsWith('Wrong chain ID')) throw error;
      throw new PreflightError('RPC_READ_FAILED', 'checking Hideki chain and block', 'HTTPS', attempt);
    }
  }
  throw new PreflightError('RPC_READ_FAILED', 'checking Hideki chain and block', 'HTTPS', 2);
}

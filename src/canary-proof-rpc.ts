import { createPublicClient, http, type Hex } from 'viem';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { RPC } from './rpc-health.ts';
import type { ProofRpc, ProofSnapshot } from './canary-proof.ts';
import { decodeExecutionError } from './execution-error-decoder.ts';

const client = createPublicClient({ chain: hidekiTestnet,
  transport: http(RPC, { timeout: 15_000, retryCount: 0 }) });
export const canaryProofRpc: ProofRpc = { snapshot: async (hash): Promise<ProofSnapshot> => {
  const chainId = await client.getChainId();
  if (chainId !== 50383) return { chainId, transaction: null, receipt: null };
  const txHash = hash as Hex;
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: txHash }).catch(() => null),
    client.getTransactionReceipt({ hash: txHash }).catch(() => null),
  ]);
  return { chainId,
    transaction: tx ? { hash: tx.hash, from: tx.from, to: tx.to,
      input: tx.input, value: tx.value.toString(), nonce: tx.nonce,
      gas: tx.gas.toString(), gasPrice: tx.gasPrice?.toString() ?? null,
      blockHash: tx.blockHash, blockNumber: tx.blockNumber?.toString() ?? null } : null,
    receipt: receipt ? { transactionHash: receipt.transactionHash,
      blockHash: receipt.blockHash, blockNumber: receipt.blockNumber.toString(),
      status: receipt.status === 'success' ? '0x1' : '0x0', from: receipt.from,
      to: receipt.to, gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.effectiveGasPrice.toString(),
      logs: receipt.logs.map(log => ({ address: log.address, topics: log.topics,
        data: log.data, logIndex: `0x${log.logIndex.toString(16)}`,
        transactionHash: log.transactionHash, removed: log.removed })) } : null };
} };

export async function replayMinedFailure(snapshot: ProofSnapshot) {
  const tx = snapshot.transaction;
  const receipt = snapshot.receipt;
  if (snapshot.chainId !== 50383 || !tx || !receipt || receipt.status !== '0x0' ||
    !tx.to || !tx.blockNumber || BigInt(tx.blockNumber) <= 0n)
    return { status: 'UNAVAILABLE', reason: 'A mined reverted transaction with a parent block is required' };
  const parentBlock = BigInt(tx.blockNumber) - 1n;
  try {
    await client.call({ account: tx.from as Hex, to: tx.to as Hex,
      data: tx.input as Hex, value: BigInt(tx.value), gas: BigInt(tx.gas), blockNumber: parentBlock });
    return { status: 'REPLAY_SUCCEEDED_DIFFERENT_CONTEXT', parentBlock: parentBlock.toString(),
      contract: tx.to, reason: 'Parent-block eth_call did not reproduce the mined revert' };
  } catch (error) {
    const decoded = decodeExecutionError(error, 'ETH_CALL');
    return { status: decoded.reason === 'RPC_FAILURE' ? 'UNAVAILABLE' : 'REPLAY_REVERTED',
      parentBlock: parentBlock.toString(), contract: tx.to, selector: decoded.selector ?? 'UNKNOWN',
      contractError: decoded.contractError ?? 'UNKNOWN', reason: decoded.reason,
      limitation: 'Parent-block state and eth_call context can differ from the mined transaction; this is diagnostic only' };
  }
}

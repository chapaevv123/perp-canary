import { decodeExecutionError } from './execution-error-decoder.ts';

export type SimulationFailure = { category: 'CONTRACT_REVERT' | 'RPC_FAILURE' | 'UNKNOWN';
  rpcCode: number | null; selector: string | null; contractError: string | null;
  details: string; nextAction: string; bestAsk: string | null };

export function classifySimulationFailure(error: unknown): SimulationFailure {
  const decoded = decodeExecutionError(error, 'BROWSER_PREFLIGHT');
  return { category: decoded.errorClass === 'CONTRACT_REVERT' ? 'CONTRACT_REVERT' :
    decoded.errorClass === 'RPC_TRANSPORT' ? 'RPC_FAILURE' : 'UNKNOWN',
  rpcCode: decoded.rpcCode, selector: decoded.selector, contractError: decoded.contractError,
  details: decoded.rootCause, nextAction: decoded.safeNextAction, bestAsk: null };
}

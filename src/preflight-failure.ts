export type SimulationFailure = { category: 'CONTRACT_REVERT' | 'RPC_FAILURE' | 'UNKNOWN';
  rpcCode: number | null; selector: string | null; contractError: string | null;
  details: string; nextAction: string; bestAsk: string | null };

// The selector is documented by dreamDEX and present in the installed SDK contractErrorsAbi.
const IOC_NO_FILL = '0xd48c4403';
export function classifySimulationFailure(error: unknown): SimulationFailure {
  const seen = new Set<unknown>();
  let current = error;
  let rpcCode: number | null = null;
  let selector: string | null = null;
  let details = 'RPC did not return a usable reason';
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const value = current as { cause?: unknown; code?: unknown; data?: unknown; details?: unknown; message?: unknown };
    if (typeof value.code === 'number') rpcCode = value.code;
    if (typeof value.data === 'string' && /^0x[0-9a-fA-F]{8}/.test(value.data))
      selector = value.data.slice(0, 10).toLowerCase();
    if (typeof value.details === 'string' && value.details.length < 200) details = value.details;
    current = value.cause;
  }
  if (rpcCode === 3 || selector) {
    const contractError = selector === IOC_NO_FILL ? 'ImmediateOrCancelNoFill()' : null;
    return { category: 'CONTRACT_REVERT', rpcCode, selector, contractError, details,
      nextAction: contractError ?
        'Review the current on-chain best ask. Choose a BUY limit at or above an acceptable ask only if it fits your slippage limit, then build a new plan; do not reuse this plan.' :
        'Inspect the documented contract error and rebuild only after its cause is resolved; never bypass simulation.',
      bestAsk: null };
  }
  return { category: rpcCode === null ? 'UNKNOWN' : 'RPC_FAILURE', rpcCode,
    selector: null, contractError: null, details,
    nextAction: 'Check Hideki RPC health and repeat read-only preflight; never bypass simulation.', bestAsk: null };
}

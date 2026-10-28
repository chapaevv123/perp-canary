import { isTimeout, PreflightError } from './rpc-health.ts';

/** A failed read-only preparation stage. Never contains wallet secrets or raw RPC payloads. */
export class TradeStageError extends Error {
  readonly code: string;
  readonly phase: string;
  readonly retryable: boolean;
  constructor(phase: string, code: string, retryable: boolean) {
    super(`${phase}: ${code === 'READ_TIMEOUT' || code === 'RPC_TIMEOUT' ? 'the upstream read timed out' :
      code === 'VERIFICATION_FAILED' ? 'identity or contract metadata did not match the verified deployment' :
        'the upstream read could not be verified'}. No transaction was requested.`);
    this.name = 'TradeStageError';
    this.phase = phase;
    this.code = code;
    this.retryable = retryable;
  }
}

export class TradeUserError extends Error {
  readonly code = 'ACTION_PREREQUISITE';
  constructor(message: string) { super(message); this.name = 'TradeUserError'; }
}

export async function tradeStage<T>(phase: string, work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof TradeStageError) throw error;
    if (error instanceof PreflightError)
      throw new TradeStageError(`${phase} / ${error.phase}`, error.code, true);
    if (error instanceof Error && /\b(mismatch|differs|absent from verified registry|invalid wallet address|wrong chain)\b/i.test(error.message))
      throw new TradeStageError(phase, 'VERIFICATION_FAILED', false);
    throw new TradeStageError(phase, isTimeout(error) ? 'READ_TIMEOUT' : 'READ_FAILED', true);
  }
}

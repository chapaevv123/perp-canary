import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonical, sha256 } from './evidence.ts';
import type { PreparedPlan } from './delegated-plan.ts';
import type { DecodedExecutionError } from './execution-error-decoder.ts';
import type { inspectTradingAuthorization } from './trading-authorization.ts';

type Observation = Awaited<ReturnType<typeof inspectTradingAuthorization>>;
export type ExecutionDiagnostic = { schema: 'perp-canary/execution-diagnostic/v1';
  observedAt: string; planHash: string; intentId: string; chainId: number;
  rpc: string; owner: string; operator: string; target: string; calldataSha256: string;
  side: string; price: string; quantity: string; expiresAt: string;
  planBlock: string; recheckBlock: string; bestBidAtPlanRaw: string;
  bestAskAtPlanRaw: string; bestBidNowRaw: string; bestAskNowRaw: string;
  markAtPlanRaw: string; markNowRaw: string; marginAtPlan: string;
  marginNow: string; estimatedGasAtPlan: string; estimatedGasNow: string;
  error: DecodedExecutionError; hash: string };
export async function saveExecutionDiagnostic(dir: string, plan: PreparedPlan,
  observation: Observation | undefined, error: DecodedExecutionError, rpc: string): Promise<ExecutionDiagnostic> {
  const body = { schema: 'perp-canary/execution-diagnostic/v1' as const,
    observedAt: new Date().toISOString(), planHash: plan.hash, intentId: plan.intentId,
    chainId: plan.chainId, rpc, owner: plan.owner, operator: plan.operator,
    target: plan.transaction?.to ?? plan.pool, calldataSha256: sha256(plan.transaction?.data ?? ''),
    side: plan.side, price: plan.price, quantity: plan.quantity, expiresAt: plan.expiresAt,
    planBlock: plan.sampledBlock, recheckBlock: observation?.sampledBlock ?? 'UNKNOWN',
    bestBidAtPlanRaw: plan.bookTops?.bestBidRaw ?? 'UNKNOWN',
    bestAskAtPlanRaw: plan.bookTops?.bestAskRaw ?? 'UNKNOWN',
    bestBidNowRaw: observation?.bookTops?.bestBidRaw ?? 'UNKNOWN',
    bestAskNowRaw: observation?.bookTops?.bestAskRaw ?? 'UNKNOWN',
    markAtPlanRaw: plan.markPriceRaw, markNowRaw: observation?.markPriceRaw ?? 'UNKNOWN',
    marginAtPlan: plan.risk.marginBankUnlocked, marginNow: observation?.marginBankUnlocked ?? 'UNKNOWN',
    estimatedGasAtPlan: plan.risk.estimatedGasUnits,
    estimatedGasNow: observation?.estimatedGasUnits ?? 'UNKNOWN', error };
  const record = { ...body, hash: sha256(body) };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${Date.parse(record.observedAt)}-${record.hash.slice(0, 12)}.json`),
    `${canonical(record)}\n`, { flag: 'wx' });
  return record;
}
export function formatExecutionDiagnostic(record: ExecutionDiagnostic, directory = 'bot-execution-diagnostics'): string {
  const e = record.error;
  return [`EXECUTION ${e.transactionSent === 'UNKNOWN' ? 'UNKNOWN' : 'BLOCKED'}`,
    `Stage: ${e.stage}`, `Reason: ${e.reason}`, `Class: ${e.errorClass}`,
    `Contract: ${e.contractError ?? 'UNKNOWN'}`, `Selector: ${e.selector ?? 'UNKNOWN'}`,
    `Best Ask at plan: ${record.bestAskAtPlanRaw}`,
    `Best Ask now: ${record.bestAskNowRaw}`, `Limit: ${record.price}`,
    `Quantity: ${record.quantity}`, `Transaction sent: ${e.transactionSent}`,
    `Action: ${e.safeNextAction}`, `Diagnostics: ${directory}/${Date.parse(record.observedAt)}-${record.hash.slice(0, 12)}.json`,
    `Diagnostic SHA-256: ${record.hash}`].join('\n');
}
export async function readExecutionDiagnostics(dir: string): Promise<ExecutionDiagnostic[]> {
  let files: string[];
  try { files = (await readdir(dir)).filter(name => /^\d{13}-[0-9a-f]{12}\.json$/.test(name)).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const records = await Promise.all(files.map(async file =>
    JSON.parse(await readFile(join(dir, file), 'utf8')) as ExecutionDiagnostic));
  for (const [index, record] of records.entries()) {
    const { hash, ...body } = record;
    if (record.schema !== 'perp-canary/execution-diagnostic/v1' ||
      hash !== sha256(body) || !files[index]!.endsWith(`${hash.slice(0, 12)}.json`))
      throw Error('Execution diagnostic evidence invalid');
  }
  return records;
}

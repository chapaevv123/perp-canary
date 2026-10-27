import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonical, sha256 } from './evidence.ts';

export type ExecutionState = 'RESERVED' | 'SIGNED' | 'BROADCAST_UNKNOWN' | 'BROADCAST_ACCEPTED' |
  'REVERTED' | 'VERIFIED' | 'AMBER' | 'RED' | 'BLOCKED_PRE_BROADCAST';
export type ExecutionEntry = { schema: 'perp-canary/execution-state/v1'; planHash: string;
  intentId: string; state: ExecutionState; txHash: string | null; at: string;
  previousHash: string | null; hash: string };
const entryPattern = /^state-\d{4}\.json$/;
function validateId(id: string): void { if (!/^[0-9a-f]{64}$/.test(id)) throw Error('Invalid intent ID'); }
export async function readExecutionLedger(root: string, intentId: string): Promise<ExecutionEntry[]> {
  validateId(intentId);
  const dir = join(root, intentId);
  let files: string[];
  try { files = (await readdir(dir)).filter(name => entryPattern.test(name)).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const records = await Promise.all(files.map(async name => JSON.parse(await readFile(join(dir, name), 'utf8')) as ExecutionEntry));
  let previous: string | null = null;
  for (const [index, record] of records.entries()) {
    const { hash, ...body } = record;
    if (files[index] !== `state-${String(index + 1).padStart(4, '0')}.json` ||
      record.schema !== 'perp-canary/execution-state/v1' || record.intentId !== intentId ||
      record.previousHash !== previous || hash !== sha256(body) ||
      (index > 0 && record.txHash !== records[1]?.txHash)) throw Error('Execution ledger invalid');
    previous = hash;
  }
  return records;
}
export async function readAllExecutionLedgers(root: string): Promise<ExecutionEntry[][]> {
  let names: string[];
  try { names = await readdir(root); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const intents = names.filter(name => /^[0-9a-f]{64}$/.test(name)).sort();
  const ledgers = await Promise.all(intents.map(name => readExecutionLedger(root, name)));
  if (ledgers.some(entries => entries.length === 0)) throw Error('Empty execution intent reservation');
  return ledgers;
}
export async function reserveIntent(root: string, intentId: string, planHash: string): Promise<void> {
  validateId(intentId);
  await mkdir(root, { recursive: true });
  await mkdir(join(root, intentId)); // atomic cross-process exclusive lock; never auto-released
  await appendExecutionState(root, intentId, planHash, 'RESERVED', null);
}
export async function appendExecutionState(root: string, intentId: string, planHash: string,
  state: ExecutionState, txHash: string | null): Promise<ExecutionEntry> {
  const history = await readExecutionLedger(root, intentId);
  if (history.length && history[0]?.planHash !== planHash) throw Error('Intent already belongs to another plan');
  if (!history.length && state !== 'RESERVED') throw Error('Intent is not reserved');
  const previousState = history.at(-1)?.state;
  const allowed: Record<ExecutionState, ExecutionState[]> = {
    RESERVED: ['SIGNED', 'BLOCKED_PRE_BROADCAST'], SIGNED: ['BROADCAST_UNKNOWN', 'BROADCAST_ACCEPTED',
      'REVERTED', 'VERIFIED', 'AMBER', 'RED'],
    BROADCAST_UNKNOWN: ['REVERTED', 'VERIFIED', 'AMBER', 'RED'],
    BROADCAST_ACCEPTED: ['REVERTED', 'VERIFIED', 'AMBER', 'RED'],
    REVERTED: [], VERIFIED: [], AMBER: [], RED: [], BLOCKED_PRE_BROADCAST: [],
  };
  if (previousState && !allowed[previousState].includes(state)) throw Error('Execution state transition rejected');
  if ((['RESERVED', 'BLOCKED_PRE_BROADCAST'].includes(state) && txHash !== null) ||
    (!['RESERVED', 'BLOCKED_PRE_BROADCAST'].includes(state) && (!/^0x[0-9a-fA-F]{64}$/.test(txHash ?? '') ||
      (history.length > 1 && history[1]?.txHash?.toLowerCase() !== txHash?.toLowerCase()))))
    throw Error('Execution transaction hash mismatch');
  const body = { schema: 'perp-canary/execution-state/v1' as const, planHash, intentId, state, txHash,
    at: new Date().toISOString(), previousHash: history.at(-1)?.hash ?? null };
  const entry = { ...body, hash: sha256(body) };
  await writeFile(join(root, intentId, `state-${String(history.length + 1).padStart(4, '0')}.json`),
    `${canonical(entry)}\n`, { flag: 'wx' });
  return entry;
}

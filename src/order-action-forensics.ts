import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonical, sha256 } from './evidence.ts';
import type { ForensicsBody } from './trade-forensics.ts';
import type { OrderActionPlan, OrderSnapshot } from './order-actions.ts';

export type OrderActionForensic = { schema: 'perp-canary/order-action-forensic/v1';
  planHash: string; intentId: string; txHash: string; operation: 'CANCEL' | 'REDUCE_ORDER';
  verdict: 'VERIFIED' | 'AMBER' | 'RED'; reasons: string[]; before: OrderSnapshot;
  after: OrderSnapshot | null; source: ForensicsBody; sourceHash: string; hash: string };
const same = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
export function assessOrderAction(plan: OrderActionPlan, source: ForensicsBody,
  after: OrderSnapshot | null): OrderActionForensic {
  if (!plan.before) throw Error('Order action has no verified before state');
  const red: string[] = [];
  const amber: string[] = [];
  const tx = source.transaction;
  const receipt = source.receipt;
  if (source.chainId !== 50383) red.push('Wrong chain');
  if (!tx || !receipt) amber.push('Transaction or receipt unavailable');
  if (tx && (!same(tx.hash, source.txHash) || !same(tx.from, plan.operator) ||
    !same(tx.to, plan.pool) || tx.input !== plan.transaction?.data)) red.push('Transaction differs from plan');
  if (receipt && (!same(receipt.transactionHash, source.txHash) ||
    !same(receipt.from, plan.operator) || !same(receipt.to, plan.pool) ||
    (tx && !same(receipt.blockHash, tx.blockHash)))) red.push('Receipt identity mismatch');
  if (receipt && receipt.status !== '0x1') red.push('Receipt reverted');
  const eventName = plan.operation === 'CANCEL' ? 'OrderCancelled' : 'OrderReduced';
  const event = source.decodedEvents.find(row => row.eventName === eventName &&
    same(row.address, plan.pool) && String(row.args.orderId) === plan.orderId);
  if (!event) amber.push(`${eventName} event missing`);
  if (plan.operation === 'CANCEL') {
    if (after) red.push('Cancelled order remains active');
  } else {
    if (!after) red.push('Reduced order disappeared');
    else if (after.id !== plan.orderId || !same(after.owner, plan.owner) ||
      BigInt(after.remainingRaw) !== BigInt(plan.newRemainingRaw ?? '-1')) red.push('Remaining order state mismatch');
    if (event && String(event.args.newQuantity) !== plan.newRemainingRaw)
      red.push('OrderReduced quantity mismatch');
  }
  if (after && after.positionRaw !== plan.before.positionRaw)
    amber.push('Position changed independently of order maintenance');
  const record = { schema: 'perp-canary/order-action-forensic/v1' as const,
    planHash: plan.hash, intentId: plan.intentId, txHash: source.txHash,
    operation: plan.operation, verdict: red.length ? 'RED' as const : amber.length ? 'AMBER' as const : 'VERIFIED' as const,
    reasons: [...red, ...amber], before: plan.before, after, source, sourceHash: sha256(source) };
  return { ...record, hash: sha256(record) };
}
export async function saveOrderActionForensic(dir: string, record: OrderActionForensic): Promise<void> {
  const { hash, ...body } = record;
  if (hash !== sha256(body) || record.sourceHash !== sha256(record.source)) throw Error('Order action evidence invalid');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${record.txHash.toLowerCase()}.json`), `${canonical(record)}\n`, { flag: 'wx' });
}
export async function readOrderActionForensics(dir: string): Promise<OrderActionForensic[]> {
  let files: string[];
  try { files = (await readdir(dir)).filter(name => /^0x[0-9a-f]{64}\.json$/.test(name)).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const records = await Promise.all(files.map(async file => JSON.parse(await readFile(join(dir, file), 'utf8')) as OrderActionForensic));
  for (const [index, record] of records.entries()) {
    const { hash, ...body } = record;
    if (hash !== sha256(body) || record.sourceHash !== sha256(record.source) ||
      files[index] !== `${record.txHash.toLowerCase()}.json`) throw Error('Order action evidence invalid');
  }
  return records;
}

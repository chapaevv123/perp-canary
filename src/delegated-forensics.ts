import { readFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonical, sha256 } from './evidence.ts';
import type { ForensicsBody, TradeEvent } from './trade-forensics.ts';
import type { PreparedPlan } from './delegated-plan.ts';
import { parseUnits } from 'viem';

export type ExecutionVerdict = 'VERIFIED' | 'AMBER' | 'RED';
export type ExecutionForensic = { schema: 'perp-canary/delegated-forensic/v1'; planHash: string;
  intentId: string; txHash: string; verdict: ExecutionVerdict; observedAt: string;
  expectedQuantityRaw: string; filledQuantityRaw: string; positionBeforeRaw: string;
  positionAfterEventRaw: string | null; positionAfterReadRaw: string | null;
  orderId: string | null; reasons: string[]; sourceHash: string; source: ForensicsBody; hash: string };
const same = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const args = (e: TradeEvent) => e.args;
export function assessDelegatedTrade(plan: PreparedPlan, body: ForensicsBody,
  currentPositionRaw: string | null): ExecutionForensic {
  const red: string[] = [];
  const amber: string[] = [];
  const tx = body.transaction;
  const receipt = body.receipt;
  const expected = parseUnits(plan.quantity, 8);
  const limitPrice = parseUnits(plan.price, 18);
  if (!tx || !receipt) amber.push('Transaction or receipt unavailable');
  if (tx && receipt && (!same(tx.hash, body.txHash) || !same(receipt.transactionHash, body.txHash) ||
    !same(tx.blockHash, receipt.blockHash))) red.push('Transaction or receipt identity mismatch');
  if (body.chainId !== 50383) red.push('Wrong chain');
  if (tx && (!same(tx.from, plan.operator) || !same(tx.to, plan.pool) || tx.input !== plan.transaction?.data))
    red.push('Sender, target or calldata differs from plan');
  if (receipt && (!same(receipt.from, plan.operator) || !same(receipt.to, plan.pool)))
    red.push('Receipt sender or target mismatch');
  if (receipt && receipt.status !== '0x1') red.push('Transaction reverted');
  if (body.marketIdentity.status !== 'VERIFIED') amber.push('LIVE market identity unavailable');
  const placed = body.decodedEvents.find(e => e.eventName === 'OrderPlaced' && same(e.address, plan.pool) &&
    same((args(e).placedOrder as Record<string, unknown> | undefined)?.owner, plan.owner));
  const placedOrder = placed?.args.placedOrder as Record<string, unknown> | undefined;
  const orderId = placed ? String(placed.args.orderId) : null;
  if (!placed || !placedOrder) amber.push('Wallet-owned OrderPlaced missing');
  else if (String(placedOrder.fullQuantity) !== expected.toString() ||
    placedOrder.isBid !== (plan.side === 'BUY') ||
    String(placedOrder.price) !== limitPrice.toString()) red.push('OrderPlaced side, price or quantity mismatch');
  const fills = body.decodedEvents.filter(e => e.eventName === 'OrderFilled' && same(e.address, plan.pool) &&
    orderId !== null && String(args(e).takerOrderId) === orderId);
  let filled = 0n;
  for (const fill of fills) {
    try {
      const qty = BigInt(String(fill.args.quantityFilled));
      const price = BigInt(String(fill.args.fillPrice));
      if (qty <= 0n || (plan.side === 'BUY' ? price > limitPrice : price < limitPrice))
        red.push('Invalid fill quantity or limit price');
      filled += qty;
    } catch { red.push('Malformed fill event'); }
  }
  if (filled > expected) red.push('Overfill');
  if (!fills.length) amber.push('No OrderFilled event');
  else if (filled < expected) amber.push('Partial fill');
  const positionEvent = body.decodedEvents.filter(e => e.eventName === 'PositionUpdated' &&
    same(e.args.account, plan.owner) && same(e.args.perpPool, plan.pool)).at(-1);
  const positionAfter = positionEvent ? String(positionEvent.args.newSize) : null;
  if (filled > 0n && !positionAfter) amber.push('PositionUpdated missing');
  if (currentPositionRaw !== null && !positionAfter) {
    try {
      if (BigInt(currentPositionRaw) !== BigInt(plan.positionSizeBeforeRaw))
        red.push('Position changed without matching PositionUpdated event');
    } catch { red.push('Malformed current position'); }
  }
  if (positionAfter) {
    try {
      const expectedAfter = BigInt(plan.positionSizeBeforeRaw) + (plan.side === 'BUY' ? filled : -filled);
      if (BigInt(positionAfter) !== expectedAfter) red.push('Position delta mismatch');
      if (currentPositionRaw === null) amber.push('Current on-chain position unavailable');
      else if (BigInt(currentPositionRaw) !== BigInt(positionAfter)) amber.push('Current position differs from receipt event');
    } catch { red.push('Malformed position event'); }
  }
  const verdict: ExecutionVerdict = red.length ? 'RED' : amber.length ? 'AMBER' : 'VERIFIED';
  const sourceHash = sha256(body);
  const record = { schema: 'perp-canary/delegated-forensic/v1' as const, planHash: plan.hash,
    intentId: plan.intentId, txHash: body.txHash, verdict, observedAt: new Date().toISOString(),
    expectedQuantityRaw: expected.toString(), filledQuantityRaw: filled.toString(),
    positionBeforeRaw: plan.positionSizeBeforeRaw, positionAfterEventRaw: positionAfter,
    positionAfterReadRaw: currentPositionRaw, orderId, reasons: [...red, ...amber], sourceHash,
    source: body };
  return { ...record, hash: sha256(record) };
}
export async function saveForensicEvidence(dir: string, record: ExecutionForensic): Promise<void> {
  const { hash, ...body } = record;
  if (hash !== sha256(body) || record.sourceHash !== sha256(record.source) ||
    !same(record.source.txHash, record.txHash)) throw Error('Forensic evidence hash invalid');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${record.txHash.toLowerCase()}.json`), `${canonical(record)}\n`, { flag: 'wx' });
}
export async function readForensicEvidence(dir: string): Promise<ExecutionForensic[]> {
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir)).filter(name => /^0x[0-9a-f]{64}\.json$/.test(name)).sort();
  const records = await Promise.all(files.map(async name => JSON.parse(await readFile(join(dir, name), 'utf8')) as ExecutionForensic));
  for (const [i, record] of records.entries()) {
    const { hash, ...body } = record;
    if (record.schema !== 'perp-canary/delegated-forensic/v1' || hash !== sha256(body) ||
      record.sourceHash !== sha256(record.source) || !same(record.source.txHash, record.txHash) ||
      files[i] !== `${record.txHash.toLowerCase()}.json`) throw Error('Forensic evidence invalid');
  }
  return records;
}

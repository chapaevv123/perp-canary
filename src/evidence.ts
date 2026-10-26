import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type Gate = 'GREEN' | 'AMBER' | 'RED' | 'UNKNOWN';
export interface MarketObservation {
  poolAddress: string;
  symbol: string;
  market: unknown;
  poolStatus: unknown;
  feed: unknown;
  gate: Gate;
  reasons: string[];
}
export interface SnapshotBody {
  schema: 'perp-canary/snapshot/v1';
  mode: 'LIVE';
  observedAt: string;
  chainId: number;
  blockNumber: string;
  blockHash: string;
  blockTimestamp: string;
  sources: { sdk: string; rpc: string; indexer: string };
  sdkVersion: string;
  systemConfig: unknown;
  markets: MarketObservation[];
  previousHash: string | null;
  limitations: string[];
}
export interface Snapshot extends SnapshotBody { hash: string }

export function normalize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, normalize(v)]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite evidence number');
  return value;
}

export function canonical(value: unknown): string { return JSON.stringify(normalize(value)); }
export function sha256(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function seal(body: SnapshotBody): Snapshot { return { ...body, hash: sha256(body) }; }

export function verify(snapshots: Snapshot[]): void {
  let previous: string | null = null;
  for (const [i, snapshot] of snapshots.entries()) {
    const { hash, ...body } = snapshot;
    if (snapshot.schema !== 'perp-canary/snapshot/v1' || snapshot.mode !== 'LIVE') throw new Error(`Invalid snapshot ${i}`);
    if (hash !== sha256(body)) throw new Error(`Hash mismatch at ${i}`);
    if (body.previousHash !== previous) throw new Error(`Chain break at ${i}`);
    if (!/^0x[0-9a-fA-F]{64}$/.test(body.blockHash) || !/^\d+$/.test(body.blockNumber)) throw new Error(`Invalid block at ${i}`);
    previous = hash;
  }
}

export async function readSnapshots(dir: string): Promise<Snapshot[]> {
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir)).filter(name => /^snapshot-\d{13}-[0-9a-f]{12}\.json$/.test(name)).sort();
  const snapshots = await Promise.all(files.map(async name => JSON.parse(await readFile(join(dir, name), 'utf8')) as Snapshot));
  verify(snapshots);
  return snapshots;
}

export async function appendSnapshot(dir: string, body: Omit<SnapshotBody, 'previousHash'>): Promise<string> {
  const history = await readSnapshots(dir);
  const snapshot = seal({ ...body, previousHash: history.at(-1)?.hash ?? null });
  const files = (await readdir(dir)).filter(name => /^snapshot-\d{13}-[0-9a-f]{12}\.json$/.test(name)).sort();
  const last = files.at(-1);
  const lastMillis = last ? Number(last.slice(9, 22)) : 0;
  const millis = Math.max(Date.now(), lastMillis + 1);
  const file = join(dir, `snapshot-${millis}-${snapshot.hash.slice(0, 12)}.json`);
  await writeFile(file, `${canonical(snapshot)}\n`, { flag: 'wx' });
  return file;
}

export function evaluateFeed(feed: unknown): { gate: Gate; reasons: string[] } {
  if (!feed || typeof feed !== 'object') return { gate: 'UNKNOWN', reasons: ['Feed read unavailable'] };
  const f = feed as Record<string, unknown>;
  if (typeof f.markPriceOk !== 'boolean' || typeof f.markPrice !== 'string' || !/^\d+$/.test(f.markPrice)) {
    return { gate: 'UNKNOWN', reasons: ['Invalid feed shape'] };
  }
  if (!f.markPriceOk || BigInt(f.markPrice) === 0n) return { gate: 'RED', reasons: ['Pool reports unavailable or zero mark price'] };
  if (f.indexUpdatedAt === undefined) return { gate: 'AMBER', reasons: ['Index timestamp unavailable'] };
  return { gate: 'GREEN', reasons: ['Pool mark feed live'] };
}

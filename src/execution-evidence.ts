import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonical, sha256 } from './evidence.ts';

export interface ExecutionRecord {
  schema: 'perp-canary/execution-evidence/v1';
  kind: 'PLAN' | 'RECONCILIATION';
  createdAt: string;
  previousHash: string | null;
  payload: unknown;
  hash: string;
}

export async function readExecutionRecords(dir: string): Promise<ExecutionRecord[]> {
  await mkdir(dir, { recursive: true });
  const names = (await readdir(dir)).filter(name => /^record-\d{13}-[0-9a-f]{12}\.json$/.test(name)).sort();
  const records = await Promise.all(names.map(async name => JSON.parse(await readFile(join(dir, name), 'utf8')) as ExecutionRecord));
  let previous: string | null = null;
  for (const [index, record] of records.entries()) {
    const { hash, ...body } = record;
    if (record.schema !== 'perp-canary/execution-evidence/v1' || hash !== sha256(body) || record.previousHash !== previous) {
      throw new Error(`Execution evidence chain invalid at record ${index}`);
    }
    previous = hash;
  }
  return records;
}

let queue: Promise<unknown> = Promise.resolve();
export function appendExecutionRecord(dir: string, kind: ExecutionRecord['kind'], payload: unknown): Promise<ExecutionRecord> {
  const task = queue.then(async () => {
    const history = await readExecutionRecords(dir);
    const body = { schema: 'perp-canary/execution-evidence/v1' as const, kind,
      createdAt: new Date().toISOString(), previousHash: history.at(-1)?.hash ?? null, payload };
    const record = { ...body, hash: sha256(body) };
    const last = (await readdir(dir)).filter(name => /^record-\d{13}-[0-9a-f]{12}\.json$/.test(name)).sort().at(-1);
    const millis = Math.max(Date.now(), last ? Number(last.slice(7, 20)) + 1 : 0);
    await writeFile(join(dir, `record-${millis}-${record.hash.slice(0, 12)}.json`), `${canonical(record)}\n`, { flag: 'wx' });
    return record;
  });
  queue = task.catch(() => undefined);
  return task;
}

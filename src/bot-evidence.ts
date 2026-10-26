import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonical, sha256 } from './evidence.ts';
import type { BotExecutionPlan } from './bot-foundation.ts';

type RecordBody = { schema: 'perp-canary/bot-plan-evidence/v1'; createdAt: string;
  previousHash: string | null; plan: BotExecutionPlan };
export type BotPlanRecord = RecordBody & { hash: string };
const pattern = /^bot-plan-\d{13}-[0-9a-f]{12}\.json$/;
export async function readBotPlanEvidence(dir: string): Promise<BotPlanRecord[]> {
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir)).filter(name => pattern.test(name)).sort();
  const records = await Promise.all(files.map(async name => JSON.parse(await readFile(join(dir, name), 'utf8')) as BotPlanRecord));
  let previous: string | null = null;
  for (const record of records) {
    const { hash, ...body } = record;
    const { hash: planHash, ...planBody } = body.plan;
    if (body.schema !== 'perp-canary/bot-plan-evidence/v1' || body.previousHash !== previous ||
      hash !== sha256(body) || planHash !== sha256(planBody) || body.plan.status !== 'BLOCKED')
      throw Error('Bot plan evidence invalid');
    previous = hash;
  }
  return records;
}
let queue: Promise<unknown> = Promise.resolve();
export function appendBotPlanEvidence(dir: string, plan: BotExecutionPlan): Promise<BotPlanRecord> {
  const task = queue.then(async () => {
    const history = await readBotPlanEvidence(dir);
    const previousHash = history.at(-1)?.hash ?? null;
    const body: RecordBody = { schema: 'perp-canary/bot-plan-evidence/v1', createdAt: new Date().toISOString(),
      previousHash, plan };
    const record = { ...body, hash: sha256(body) };
    const files = (await readdir(dir)).filter(name => pattern.test(name)).sort();
    const lastMillis = files.at(-1) ? Number(files.at(-1)!.slice(9, 22)) : 0;
    const millis = Math.max(Date.now(), lastMillis + 1);
    await writeFile(join(dir, `bot-plan-${millis}-${record.hash.slice(0, 12)}.json`), `${canonical(record)}\n`, { flag: 'wx' });
    return record;
  });
  queue = task.catch(() => undefined);
  return task;
}

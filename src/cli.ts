import { resolve } from 'node:path';
import { appendSnapshot, readSnapshots } from './evidence.ts';

const dir = resolve('evidence');
const command = process.argv[2];
try {
  if (command === 'snapshot') {
    const { collectLive } = await import('./live.ts');
    const body = await collectLive();
    const file = await appendSnapshot(dir, body);
    console.log(JSON.stringify({ file, blockNumber: body.blockNumber, markets: body.markets.length,
      gateCounts: Object.fromEntries(['GREEN', 'AMBER', 'RED', 'UNKNOWN'].map(gate => [gate, body.markets.filter(m => m.gate === gate).length])) }, null, 2));
  } else if (command === 'verify') {
    const snapshots = await readSnapshots(dir);
    const { readExecutionRecords } = await import('./execution-evidence.ts');
    const execution = await readExecutionRecords(resolve('execution-evidence'));
    console.log(JSON.stringify({ valid: true, snapshots: snapshots.length, head: snapshots.at(-1)?.hash ?? null,
      executionRecords: execution.length, executionHead: execution.at(-1)?.hash ?? null }, null, 2));
  } else {
    throw new Error('Usage: npm run snapshot | npm run verify');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

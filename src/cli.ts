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
    const { readTradeArtifacts } = await import('./trade-evidence.ts');
    const trades = await readTradeArtifacts(resolve('trade-evidence'));
    const { readAuthorizationArtifacts } = await import('./authorization-evidence.ts');
    const authorizations = await readAuthorizationArtifacts(resolve('authorization-evidence'));
    const { readBotPlanEvidence } = await import('./bot-evidence.ts');
    const botPlans = await readBotPlanEvidence(resolve('bot-evidence'));
    const { readForensicEvidence } = await import('./delegated-forensics.ts');
    const botForensics = await readForensicEvidence(resolve('bot-execution-forensics'));
    const { readOrderActionForensics } = await import('./order-action-forensics.ts');
    const orderActionForensics = await readOrderActionForensics(resolve('bot-order-action-forensics'));
    const { readAllExecutionLedgers } = await import('./execution-ledger.ts');
    const botExecutionLedgers = await readAllExecutionLedgers(resolve('bot-execution-ledger'));
    const { readExecutionDiagnostics } = await import('./execution-diagnostics.ts');
    const diagnostics = await readExecutionDiagnostics(resolve('bot-execution-diagnostics'));
    console.log(JSON.stringify({ valid: true, snapshots: snapshots.length, head: snapshots.at(-1)?.hash ?? null,
      executionRecords: execution.length, executionHead: execution.at(-1)?.hash ?? null,
      tradeArtifacts: trades.length, tradeHashes: trades.map(trade => trade.hash),
      authorizationArtifacts: authorizations.length, authorizationHashes: authorizations.map(artifact => artifact.hash),
      botPlanRecords: botPlans.length, botPlanHead: botPlans.at(-1)?.hash ?? null,
      botForensicRecords: botForensics.length, orderActionForensicRecords: orderActionForensics.length,
      botExecutionIntents: botExecutionLedgers.length, botExecutionDiagnostics: diagnostics.length }, null, 2));
  } else {
    throw new Error('Usage: npm run snapshot | npm run verify');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

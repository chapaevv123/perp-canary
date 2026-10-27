import { readBotPlanEvidence } from './bot-evidence.ts';
import { readExecutionLedger } from './execution-ledger.ts';
import { buildCanaryProof, verifyCanaryProof } from './canary-proof.ts';
import { canaryProofRpc } from './canary-proof-rpc.ts';
import { discoverBtcOrders } from './order-actions.ts';
import { summarizeFirstProofStatus } from './first-proof-status.ts';

try {
  const [hash] = process.argv.slice(2);
  if (process.argv.length !== 3 || !/^[0-9a-f]{64}$/.test(hash ?? ''))
    throw Error('Usage: npm.cmd run canary-status -- <plan-hash>');
  const record = (await readBotPlanEvidence('bot-evidence')).find(row => row.plan.hash === hash);
  if (!record || record.plan.schema !== 'perp-canary/delegated-plan/v2' ||
    record.plan.executionMode !== 'POST_ONLY') throw Error('Verified PostOnly PLACE plan not found');
  const plan = record.plan;
  const ledger = await readExecutionLedger('bot-execution-ledger', plan.intentId);
  const txHash = ledger.at(-1)?.txHash ?? null;
  const snapshot = txHash ? await canaryProofRpc.snapshot(txHash).catch(() => null) : null;
  const bundle = buildCanaryProof(plan, ledger, snapshot);
  const verification = await verifyCanaryProof(bundle, canaryProofRpc);
  const discovery = snapshot?.receipt ? await discoverBtcOrders().catch(() => null) : null;
  console.log(JSON.stringify({ mode: 'LIVE_READ_ONLY',
    ...summarizeFirstProofStatus(plan, verification, snapshot, discovery),
    transactionSent: !txHash ? 'NO_RECORDED_TX' : snapshot?.receipt ? 'YES_MINED' :
      ['SIGNED', 'BROADCAST_UNKNOWN'].includes(ledger.at(-1)?.state ?? '') ? 'UNKNOWN' : 'RPC_ACCEPTED_NOT_MINED',
    proofCommand: `npm.cmd run canary-proof -- create ${plan.hash}` }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Read-only status failed');
  process.exitCode = 1;
}

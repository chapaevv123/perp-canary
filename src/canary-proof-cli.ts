import { readBotPlanEvidence } from './bot-evidence.ts';
import { readExecutionLedger } from './execution-ledger.ts';
import { buildCanaryProof, saveCanaryProof } from './canary-proof.ts';
import { canaryProofRpc } from './canary-proof-rpc.ts';

try {
  const [command, hash] = process.argv.slice(2);
  if (process.argv.length !== 4 || command !== 'create' || !/^[0-9a-f]{64}$/.test(hash ?? ''))
    throw Error('Usage: npm.cmd run canary-proof -- create <plan-hash>');
  const record = (await readBotPlanEvidence('bot-evidence')).find(item => item.plan.hash === hash);
  if (!record || (record.plan.schema !== 'perp-canary/delegated-plan/v2' &&
    record.plan.schema !== 'perp-canary/order-action-plan/v1')) throw Error('Verified plan not found');
  const plan = record.plan;
  const ledger = await readExecutionLedger('bot-execution-ledger', plan.intentId);
  const txHash = ledger.at(-1)?.txHash;
  const snapshot = txHash ? await canaryProofRpc.snapshot(txHash).catch(() => null) : null;
  const bundle = buildCanaryProof(plan, ledger, snapshot);
  const path = await saveCanaryProof('canary-proofs', bundle);
  console.log(JSON.stringify({ path, planHash: bundle.planHash, proofHash: bundle.hash,
    classification: bundle.execution.classification, txHash: bundle.execution.txHash,
    note: 'Run canary-verify for independent chain comparison; PREPARED is not a verified trade' }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Canary proof creation failed');
  process.exitCode = 1;
}

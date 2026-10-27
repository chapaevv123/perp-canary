import { resolve } from 'node:path';
import { readBotPlanEvidence } from './bot-evidence.ts';
import { verifyPreparedPlan, type PreparedPlan } from './delegated-plan.ts';
import { verifyOrderActionPlan, type OrderActionPlan } from './order-actions.ts';

export type ExecutableBotPlan = PreparedPlan | OrderActionPlan;
export type PlanLoadReason = 'INVALID_PLAN_HASH' | 'PLAN_NOT_FOUND' | 'PLAN_EXPIRED' |
  'EVIDENCE_CHAIN_INVALID' | 'PLAN_INTEGRITY_INVALID';
export class PlanLoadError extends Error {
  readonly reason: PlanLoadReason;
  readonly action: string;
  constructor(reason: PlanLoadReason, message: string, action: string) {
    super(message); this.name = 'PlanLoadError'; this.reason = reason; this.action = action;
  }
}
export async function loadExecutableBotPlan(dir: string, hash: string): Promise<ExecutableBotPlan> {
  if (hash.length !== 64) throw new PlanLoadError('INVALID_PLAN_HASH',
    `Plan hash has ${hash.length} characters; expected 64 lowercase hex characters.`,
    'Copy the exact planHash from the PREPARED output or saved evidence. Do not guess or execute an expired plan.');
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new PlanLoadError('INVALID_PLAN_HASH',
    'Plan hash must contain only lowercase hexadecimal characters.',
    'Copy the exact planHash from the PREPARED output.');
  let records: Awaited<ReturnType<typeof readBotPlanEvidence>>;
  try { records = await readBotPlanEvidence(dir); }
  catch { throw new PlanLoadError('EVIDENCE_CHAIN_INVALID',
    'Saved bot plan evidence failed integrity or file validation.',
    'Run npm.cmd run verify and inspect local bot-evidence; do not bypass the evidence chain.'); }
  const plan = records.find(record => record.plan.hash === hash)?.plan;
  if (!plan || (plan.schema !== 'perp-canary/delegated-plan/v2' &&
    plan.schema !== 'perp-canary/order-action-plan/v1'))
    throw new PlanLoadError('PLAN_NOT_FOUND',
      `No executable plan with this hash in ${resolve(dir)}. Evidence filenames use the record hash, not planHash.`,
      'Find the exact planHash inside the saved evidence or prepare a fresh plan; never substitute a similar hash.');
  try {
    if (plan.schema === 'perp-canary/delegated-plan/v2') verifyPreparedPlan(plan);
    else verifyOrderActionPlan(plan);
  } catch { throw new PlanLoadError('PLAN_INTEGRITY_INVALID',
    'Saved plan failed canonical SHA-256 or allowlist validation.',
    'Discard this plan and inspect the saved evidence. Never execute altered calldata.'); }
  return plan;
}

export function assertPlanNotExpired(plan: ExecutableBotPlan, now = Date.now()): void {
  if (now >= Date.parse(plan.expiresAt)) throw new PlanLoadError('PLAN_EXPIRED',
    `Plan ${plan.hash} expired at ${plan.expiresAt}.`,
    'Prepare a fresh plan; an expired hash cannot be reused.');
}

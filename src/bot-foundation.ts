import { sha256 } from './evidence.ts';
import { readBotKeystore } from './bot-keystore.ts';
import { inspectTradingAuthorization, AUTH_SOURCES, type AuthorizationInput } from './trading-authorization.ts';
import { OWNER_TRADING_WALLET, BTC_POOL } from './trade-forensics.ts';

type Observation = Awaited<ReturnType<typeof inspectTradingAuthorization>>;
export type BotConnection = { status: 'NOT_CONFIGURED' | 'UNKNOWN' | 'BLOCKED' | 'ON_CHAIN_LINK_OBSERVED';
  address: string | null; chainId: 50383; network: 'Somnia Hideki'; gasStt: string;
  tradingWallet: string; permissions: Observation['permissions'] | null;
  allowedMarkets: string[]; permissionExpiry: 'UNKNOWN'; revocationStatus: 'UNKNOWN' | 'NO_EFFECTIVE_PLACE_GRANT' | 'ACTIVE_GRANT_OBSERVED';
  sampledBlock: string | null; nextAction: string; source: string };
export function summarizeConnection(address: string | null, observation?: Observation): BotConnection {
  const common = { address, chainId: 50383 as const, network: 'Somnia Hideki' as const,
    tradingWallet: OWNER_TRADING_WALLET, permissionExpiry: 'UNKNOWN' as const,
    source: AUTH_SOURCES.bot };
  if (!address) return { ...common, status: 'NOT_CONFIGURED', gasStt: 'UNKNOWN', permissions: null,
    allowedMarkets: [], revocationStatus: 'UNKNOWN', sampledBlock: null,
    nextAction: 'Create a local encrypted bot keystore with npm run bot -- create in your own terminal.' };
  if (!observation) return { ...common, status: 'UNKNOWN', gasStt: 'UNKNOWN', permissions: null,
    allowedMarkets: [], revocationStatus: 'UNKNOWN', sampledBlock: null,
    nextAction: 'Run a read-only Hideki check; never infer a link from a local address alone.' };
  const grant = observation.permissions.place.effective.status;
  const linked = observation.chainId === 50383 && observation.registryMatches.status === 'SUPPORTED' &&
    observation.marketSupported.status === 'SUPPORTED' && grant === 'SUPPORTED';
  return { ...common, status: linked ? 'ON_CHAIN_LINK_OBSERVED' : grant === 'BLOCKED' ? 'BLOCKED' : 'UNKNOWN',
    gasStt: observation.operatorGasStt, permissions: observation.permissions,
    allowedMarkets: linked ? [observation.market] : [], sampledBlock: observation.sampledBlock,
    revocationStatus: linked ? 'ACTIVE_GRANT_OBSERVED' : grant === 'BLOCKED' ? 'NO_EFFECTIVE_PLACE_GRANT' : 'UNKNOWN',
    nextAction: linked ? 'Review gas, collateral, and a fresh order preflight. M3.0 signing remains disabled.' :
      'In official dreamDEX, select the intended wallet, use Link a Bot for the chosen perp market, then recheck. Revoke in Manage > Bot access > Bots.' };
}
export async function inspectBotConnection(): Promise<BotConnection> {
  const keystore = await readBotKeystore();
  if (!keystore) return summarizeConnection(null);
  const observation = await inspectTradingAuthorization({ operator: keystore.address,
    tradingWallet: OWNER_TRADING_WALLET, pool: BTC_POOL });
  return summarizeConnection(keystore.address, observation);
}

export type BotExecutionPlan = { schema: 'perp-canary/bot-execution-plan/v1'; chainId: 50383;
  owner: string; operator: string; pool: string; side: 'BUY' | 'SELL'; price: string; quantity: string;
  createdAt: string; expiresAt: string; sampledBlock: string; unsigned: Observation['unsigned'];
  checks: { market: boolean; margin: boolean; gas: boolean; permission: boolean; simulation: boolean;
    chain: boolean; fresh: boolean }; intentKey: string; blockers: string[]; status: 'BLOCKED'; hash: string };
export function buildBotExecutionPlan(observation: Observation, input: Required<Pick<AuthorizationInput, 'side' | 'price' | 'quantity'>>,
  now = Date.now()): BotExecutionPlan {
  const checks = { market: observation.marketSupported.status === 'SUPPORTED',
    margin: !observation.planBlockers.some(x => /margin|collateral|maximum placeable|size/i.test(x)) &&
      observation.marginBankUnlocked !== 'UNKNOWN' && observation.unsigned !== null,
    gas: observation.operatorGasStt !== 'UNKNOWN' && !observation.planBlockers.some(x => /gas/i.test(x)) && observation.unsigned !== null,
    permission: observation.permissions.place.effective.status === 'SUPPORTED' && observation.registryMatches.status === 'SUPPORTED',
    simulation: observation.simulation.status === 'SUPPORTED', chain: observation.chainId === 50383,
    fresh: now >= Date.parse(observation.observedAt) && now - Date.parse(observation.observedAt) <= 30_000 &&
      !!observation.unsigned && now < Date.parse(observation.unsigned.expiresAt) };
  const blockers = [...observation.planBlockers];
  for (const [name, valid] of Object.entries(checks)) if (!valid) blockers.push(`${name} check unavailable or failed`);
  blockers.push('M3.0 signing and broadcasting are disabled');
  const body = { schema: 'perp-canary/bot-execution-plan/v1' as const, chainId: 50383 as const,
    owner: observation.tradingWallet, operator: observation.candidateOperator, pool: observation.pool,
    side: input.side, price: input.price, quantity: input.quantity,
    createdAt: new Date(now).toISOString(), expiresAt: observation.unsigned?.expiresAt ?? new Date(now).toISOString(),
    sampledBlock: observation.sampledBlock, unsigned: observation.unsigned, checks,
    intentKey: sha256({ chainId: 50383, owner: observation.tradingWallet, operator: observation.candidateOperator,
      pool: observation.pool, side: input.side, price: input.price, quantity: input.quantity }), blockers,
    status: 'BLOCKED' as const };
  return { ...body, hash: sha256(body) };
}
export class ExecutionLockedError extends Error { constructor() { super('M3.0 signing and broadcasting are disabled'); } }
export function signBotPlan(): never { throw new ExecutionLockedError(); }
export function broadcastBotPlan(): never { throw new ExecutionLockedError(); }
export class IntentReservations {
  private readonly pending = new Set<string>();
  reserve(key: string): void {
    if (this.pending.has(key)) throw new Error('Duplicate intent is already pending');
    this.pending.add(key);
  }
  releaseAfterReconciliation(key: string): void { this.pending.delete(key); }
}

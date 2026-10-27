import { resolve } from 'node:path';
import { createPublicClient, getAddress, http, type Address, type Hex, type TransactionSerializable } from 'viem';
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { readBotKeystore, withUnlockedBotSigner } from './bot-keystore.ts';
import { assertPlanNotExpired, loadExecutableBotPlan, PlanLoadError } from './bot-plan-loader.ts';
import { positionEffect, type PreparedPlan } from './delegated-plan.ts';
import { assessExecutionPreflight, assertExecutionMarketIntegrity, checkDelegatedPlan, ExecutionStageError,
  executeDelegatedPlan, type ExecutionPorts, type PreflightState, type ReadOnlyExecutionPorts } from './delegated-execution.ts';
import { decodeExecutionError } from './execution-error-decoder.ts';
import { formatExecutionDiagnostic, saveExecutionDiagnostic } from './execution-diagnostics.ts';
import { readExecutionLedger, appendExecutionState } from './execution-ledger.ts';
import { assessDelegatedTrade, saveForensicEvidence } from './delegated-forensics.ts';
import { collectTradeForensics, BTC_POOL, HIDEKI_MARGIN_BANK, OWNER_TRADING_WALLET } from './trade-forensics.ts';
import { inspectTradingAuthorization } from './trading-authorization.ts';
import { withSnapshotSdk } from './lifecycle.ts';
import { RPC } from './rpc-health.ts';
import { promptHidden, promptText } from './local-prompt.ts';
import { verifySignedBotTransaction } from './signed-transaction.ts';
import { confirmExecuteHash } from './execute-confirmation.ts';
import { remainingPlanSeconds } from './place-plan-config.ts';
import { discoverBtcOrders, inspectOrderAction,
  type OrderActionPlan } from './order-actions.ts';
import { assessOrderActionPreflight, executeOrderActionPlan, type OrderActionPorts } from './order-action-execution.ts';
import { assessOrderAction, saveOrderActionForensic } from './order-action-forensics.ts';

const botPlanDir = resolve('bot-evidence');
const ledgerDir = resolve('bot-execution-ledger');
const forensicDir = resolve('bot-execution-forensics');
const orderForensicDir = resolve('bot-order-action-forensics');
const diagnosticDir = resolve('bot-execution-diagnostics');
let activePlan: PreparedPlan | null = null;
let activeOperation: string | null = null;
let executionEntered = false;
const client = createPublicClient({ chain: hidekiTestnet,
  transport: http(RPC, { timeout: 15_000, retryCount: 0 }) });
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const checkMatchesSignedTerms = (check: PreflightState, transaction: TransactionSerializable): boolean =>
  check.passed && check.nonce === transaction.nonce &&
  BigInt(check.gasPriceWei) <= BigInt(transaction.gasPrice ?? 0n);
async function currentPositionRaw(): Promise<string | null> {
  const controller = new AbortController();
  const sdk = new SomniaMarkets({ chain: hidekiTestnet,
    wsRpcUrl: 'wss://api.hideki2.infra.testnet.somnia.network/ws',
    indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql',
    addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, signal: controller.signal });
  try { return await withSnapshotSdk(sdk, controller, async () =>
    (await sdk.client.getPerpPosition({ marginBank: getAddress(HIDEKI_MARGIN_BANK.toLowerCase()) as Address,
      account: OWNER_TRADING_WALLET as Address, pool: BTC_POOL as Address })).size.toString(),
  () => 'reading current BTC-PERP position', 45_000); }
  catch { return null; }
}
async function forensicRead(txHash: Hex) {
  try {
    const body = await collectTradeForensics({ txHash, tradingWallet: OWNER_TRADING_WALLET });
    if (!body.transaction || !body.receipt) return null;
    return { body, currentPositionRaw: await currentPositionRaw() };
  } catch { return null; }
}
async function signLocally(keystore: NonNullable<Awaited<ReturnType<typeof readBotKeystore>>>,
  transaction: TransactionSerializable, expected: string,
  beforeSign?: () => Promise<void>, expiresAt?: string): Promise<Hex> {
  let password = await promptHidden('Local bot keystore password: ');
  try {
    if (beforeSign) await beforeSign();
    return await withUnlockedBotSigner(keystore, password, async signer => {
      if (expiresAt && Date.now() >= Date.parse(expiresAt)) throw Error('Plan expired before signing');
      if (!same(signer.address, expected)) throw Error('Signer address mismatch');
      return signer.signTransaction(transaction);
    }); }
  finally { password = ''; }
}
async function actionForensicRead(plan: OrderActionPlan, txHash: Hex) {
  const observed = await forensicRead(txHash);
  if (!observed) return null;
  const discovery = await discoverBtcOrders();
  return { source: observed.body, after: discovery.orders.find(order => order.id === plan.orderId) ?? null };
}
async function runOrderAction(plan: OrderActionPlan,
  keystore: NonNullable<Awaited<ReturnType<typeof readBotKeystore>>>): Promise<void> {
  console.log(JSON.stringify({ operation: plan.operation, planHash: plan.hash,
    orderId: plan.orderId, owner: plan.owner, bot: plan.operator, pool: plan.pool,
    before: plan.before, newRemainingRaw: plan.newRemainingRaw, status: plan.status,
    gasBudgetWei: plan.risk.maxGasCostWei, expiresAt: plan.expiresAt }, null, 2));
  const fresh = () => inspectOrderAction(plan.operation, plan.orderId, plan.newRemainingRaw, keystore.address);
  const ports: OrderActionPorts = {
    fresh, chainId: () => client.getChainId(),
    nonce: tag => client.getTransactionCount({ address: keystore.address as Address, blockTag: tag }),
    gasPrice: () => client.getGasPrice(), gasBalance: () => client.getBalance({ address: keystore.address as Address }),
    estimateOriginal: () => client.estimateGas({ account: keystore.address as Address,
      to: getAddress(BTC_POOL), data: plan.transaction!.data, value: 0n }),
    confirm: async p => (await promptText(`Type EXECUTE ${p.operation} ${p.hash} to authorize this one action: `)) ===
      `EXECUTE ${p.operation} ${p.hash}`,
    sign: async (transaction, expected) => {
      const observation = await fresh();
      const [chainId, latestNonce, pendingNonce, gasPrice, gasBalance, simulatedGas] = await Promise.all([
        client.getChainId(), client.getTransactionCount({ address: keystore.address as Address, blockTag: 'latest' }),
        client.getTransactionCount({ address: keystore.address as Address, blockTag: 'pending' }),
        client.getGasPrice(), client.getBalance({ address: keystore.address as Address }),
        client.estimateGas({ account: keystore.address as Address, to: getAddress(BTC_POOL),
          data: plan.transaction!.data, value: 0n }),
      ]);
      const check = assessOrderActionPreflight(plan, observation, { chainId, latestNonce, pendingNonce,
        gasPrice, gasBalance, simulatedGas, now: Date.now() });
      if (!check.passed || transaction.nonce !== pendingNonce || gasPrice > BigInt(transaction.gasPrice ?? 0n))
        throw Error(`Final order action check failed: ${check.blockers.join('; ')}`);
      return signLocally(keystore, transaction, expected);
    },
    verifySigned: verifySignedBotTransaction,
    broadcastOnce: raw => client.sendRawTransaction({ serializedTransaction: raw }),
    receiptAndForensics: async tx => {
      await client.waitForTransactionReceipt({ hash: tx, timeout: 45_000, pollingInterval: 1500 });
      return actionForensicRead(plan, tx);
    },
  };
  console.log(JSON.stringify(await executeOrderActionPlan(plan, ports,
    { ledger: ledgerDir, forensics: orderForensicDir })));
}
async function main(): Promise<void> {
  const [operation, hash, txHash] = process.argv.slice(2);
  activeOperation = operation ?? null;
  if (!['execute', 'reconcile', 'check'].includes(operation ?? '') || !hash ||
    (operation !== 'reconcile' && txHash) || (operation === 'reconcile' && !txHash))
    throw Error('Usage: npm run bot-execute -- check|execute <plan-hash> | reconcile <plan-hash> <tx-hash>');
  const plan = await loadExecutableBotPlan(botPlanDir, hash);
  if (plan.schema === 'perp-canary/delegated-plan/v2') activePlan = plan;
  if (operation !== 'reconcile') assertPlanNotExpired(plan);
  const keystore = await readBotKeystore();
  if (!keystore || !same(keystore.address, plan.operator)) throw Error('Local bot address differs from saved plan');
  if (operation === 'reconcile') {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash!)) throw Error('Invalid transaction hash');
    const history = await readExecutionLedger(ledgerDir, plan.intentId);
    if (!history.some(entry => entry.txHash && same(entry.txHash, txHash!)))
      throw Error('Transaction hash does not belong to this reserved plan');
    if (plan.schema === 'perp-canary/order-action-plan/v1') {
      const evidence = await actionForensicRead(plan, txHash as Hex);
      if (!evidence) throw Error('Receipt unavailable; execution state remains UNKNOWN');
      const forensic = assessOrderAction(plan, evidence.source, evidence.after);
      await saveOrderActionForensic(orderForensicDir, forensic);
      await appendExecutionState(ledgerDir, plan.intentId, plan.hash, forensic.verdict, txHash!);
      console.log(JSON.stringify({ state: forensic.verdict, txHash, forensicHash: forensic.hash,
        reasons: forensic.reasons }));
    } else {
      const evidence = await forensicRead(txHash as Hex);
      if (!evidence) throw Error('Receipt unavailable; execution state remains UNKNOWN');
      const forensic = assessDelegatedTrade(plan, evidence.body, evidence.currentPositionRaw);
      await saveForensicEvidence(forensicDir, forensic);
      await appendExecutionState(ledgerDir, plan.intentId, plan.hash, forensic.verdict, txHash!);
      console.log(JSON.stringify({ state: forensic.verdict, txHash, forensicHash: forensic.hash,
        reasons: forensic.reasons }));
    }
    return;
  }
  if (plan.schema === 'perp-canary/order-action-plan/v1') {
    if (operation === 'check') throw Error('Read-only check currently supports PLACE plans only');
    await runOrderAction(plan, keystore); return;
  }
  const readOnlyPorts: ReadOnlyExecutionPorts = {
    fresh: () => inspectTradingAuthorization({ tradingWallet: OWNER_TRADING_WALLET,
      operator: keystore.address, pool: BTC_POOL, side: plan.side, price: plan.price,
      quantity: plan.quantity, executionMode: plan.executionMode }),
    chainId: () => client.getChainId(),
    nonce: tag => client.getTransactionCount({ address: keystore.address as Address, blockTag: tag }),
    gasPrice: () => client.getGasPrice(),
    gasBalance: () => client.getBalance({ address: keystore.address as Address }),
    estimateOriginal: p => client.estimateGas({ account: keystore.address as Address,
      to: p.transaction!.to as Address, data: p.transaction!.data, value: 0n }),
  };
  if (operation === 'check') {
    const result = await checkDelegatedPlan(plan, readOnlyPorts);
    console.log(JSON.stringify({ status: result.passed ? 'READY_FOR_OWNER_REVIEW' : 'BLOCKED',
      planHash: plan.hash, remainingSeconds: remainingPlanSeconds(plan.expiresAt),
      ...result, transactionSent: 'NO' }, null, 2));
    return;
  }
  console.log(JSON.stringify({ planHash: plan.hash, status: plan.status, chainId: plan.chainId,
    owner: plan.owner, operator: plan.operator, pool: plan.pool, side: plan.side,
    price: plan.price, quantity: plan.quantity, executionMode: plan.executionMode ?? 'IOC',
    notionalWei: plan.risk.orderNotionalWei,
    positionSizeBeforeRaw: plan.positionSizeBeforeRaw,
    positionEffect: positionEffect(plan.side, plan.quantity, plan.positionSizeBeforeRaw),
    gasLimit: plan.risk.gasLimit, gasBudgetWei: plan.risk.maxGasCostWei,
    expiresAt: plan.expiresAt, remainingSeconds: remainingPlanSeconds(plan.expiresAt),
    blockers: plan.blockers }, null, 2));
  const ports: ExecutionPorts = {
    ...readOnlyPorts,
    confirm: async p => (await confirmExecuteHash(p.hash, p.expiresAt)) === 'CONFIRMED',
    sign: async (transaction, expected) => {
        if (Date.now() >= Date.parse(plan.expiresAt) || await client.getChainId() !== 50383)
          throw Error('Plan expired or wrong chain immediately before signing');
        const [latest, pending, freshGasPrice, balance] = await Promise.all([
          client.getTransactionCount({ address: keystore.address as Address, blockTag: 'latest' }),
          client.getTransactionCount({ address: keystore.address as Address, blockTag: 'pending' }),
          client.getGasPrice(), client.getBalance({ address: keystore.address as Address }),
        ]);
        if (latest !== pending || pending !== transaction.nonce || freshGasPrice > BigInt(transaction.gasPrice ?? 0n) ||
          balance < BigInt(plan.risk.gasLimit) * BigInt(transaction.gasPrice ?? 0n))
          throw Error('Nonce, gas price, or balance changed before signing');
        const permission = await inspectTradingAuthorization({ tradingWallet: OWNER_TRADING_WALLET,
          operator: keystore.address, pool: BTC_POOL, side: plan.side, price: plan.price,
          quantity: plan.quantity, executionMode: plan.executionMode });
        assertExecutionMarketIntegrity(plan, permission);
        let simulatedGas: bigint;
        try { simulatedGas = await client.estimateGas({ account: keystore.address as Address,
          to: plan.transaction!.to as Address, data: plan.transaction!.data, value: 0n }); }
        catch (error) { throw new ExecutionStageError('ESTIMATE_GAS', error, permission); }
        const final = assessExecutionPreflight(plan, permission, { chainId: await client.getChainId(),
          latestNonce: latest, pendingNonce: pending, gasPrice: freshGasPrice,
          gasBalance: balance, simulatedGas, now: Date.now() });
        if (!final.passed) throw new ExecutionStageError('PREFLIGHT',
          Error(`Final pre-sign check failed: ${final.blockers.join('; ')}`), permission);
        return signLocally(keystore, transaction, expected, async () => {
          const last = await checkDelegatedPlan(plan, readOnlyPorts);
          if (!checkMatchesSignedTerms(last, transaction)) throw new ExecutionStageError('PREFLIGHT',
            Error(`Pre-sign check failed: ${last.blockers.join('; ') || 'Nonce or gas price changed'}`));
          if (Date.now() >= Date.parse(plan.expiresAt))
            throw new ExecutionStageError('PREFLIGHT', Error('Plan expired before signing'));
        }, plan.expiresAt);
    },
    verifySigned: async (raw, transaction, operator) => {
      const final = await checkDelegatedPlan(plan, readOnlyPorts);
      return checkMatchesSignedTerms(final, transaction) && Date.now() < Date.parse(plan.expiresAt) &&
        verifySignedBotTransaction(raw, transaction, operator);
    },
    broadcastOnce: raw => client.sendRawTransaction({ serializedTransaction: raw }),
    receiptAndForensics: async tx => {
      await client.waitForTransactionReceipt({ hash: tx, timeout: 45_000, pollingInterval: 1500 });
      return forensicRead(tx);
    },
  };
  executionEntered = true;
  const outcome = await executeDelegatedPlan(plan, ports, { ledger: ledgerDir, forensics: forensicDir });
  console.log(JSON.stringify({ ...outcome,
    transactionSent: outcome.state === 'UNKNOWN' ? 'UNKNOWN' :
      outcome.state === 'BLOCKED' ? 'NO' : outcome.txHash ? 'YES' : 'NO' }));
}
try { await main(); }
catch (error) {
  if (error instanceof PlanLoadError) {
    console.error(`EXECUTION BLOCKED\nStage: PLAN_LOAD\nReason: ${error.reason}\nDetail: ${error.message}\nTransaction sent: NO\nAction: ${error.action}`);
    process.exitCode = 1;
  } else {
    const stage = error instanceof ExecutionStageError ? error.stage :
      activeOperation === 'execute' && executionEntered ? 'BROADCAST' : 'PLAN_LOAD';
    const original = error instanceof ExecutionStageError ? error.original : error;
    const decoded = decodeExecutionError(original, stage,
      stage === 'BROADCAST' ? 'UNKNOWN' : 'NO');
    if (activePlan) {
      try {
        const diagnostic = await saveExecutionDiagnostic(diagnosticDir, activePlan,
          error instanceof ExecutionStageError ? error.observation : undefined, decoded, RPC);
        console.error(formatExecutionDiagnostic(diagnostic));
      } catch { console.error(`EXECUTION BLOCKED\nStage: ${stage}\nReason: ${decoded.reason}\nTransaction sent: ${decoded.transactionSent}\nAction: ${decoded.safeNextAction}`); }
    } else console.error(`EXECUTION BLOCKED\nStage: ${stage}\nReason: ${decoded.reason}\nTransaction sent: ${decoded.transactionSent}`);
    process.exitCode = 1;
  }
}

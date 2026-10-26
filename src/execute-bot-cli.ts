import { resolve } from 'node:path';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { readBotKeystore, withUnlockedBotSigner } from './bot-keystore.ts';
import { readBotPlanEvidence } from './bot-evidence.ts';
import { verifyPreparedPlan, type PreparedPlan } from './delegated-plan.ts';
import { assessExecutionPreflight, executeDelegatedPlan, type ExecutionPorts } from './delegated-execution.ts';
import { readExecutionLedger, appendExecutionState } from './execution-ledger.ts';
import { assessDelegatedTrade, saveForensicEvidence } from './delegated-forensics.ts';
import { collectTradeForensics, BTC_POOL, HIDEKI_MARGIN_BANK, OWNER_TRADING_WALLET } from './trade-forensics.ts';
import { inspectTradingAuthorization } from './trading-authorization.ts';
import { withSnapshotSdk } from './lifecycle.ts';
import { RPC } from './rpc-health.ts';
import { promptHidden, promptText } from './local-prompt.ts';
import { verifySignedBotTransaction } from './signed-transaction.ts';

const botPlanDir = resolve('bot-evidence');
const ledgerDir = resolve('bot-execution-ledger');
const forensicDir = resolve('bot-execution-forensics');
const client = createPublicClient({ chain: hidekiTestnet,
  transport: http(RPC, { timeout: 15_000, retryCount: 0 }) });
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
async function loadPlan(hash: string): Promise<PreparedPlan> {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw Error('Plan hash must be 64 lowercase hex characters');
  const record = (await readBotPlanEvidence(botPlanDir)).find(item => item.plan.hash === hash);
  if (!record || record.plan.schema !== 'perp-canary/delegated-plan/v2') throw Error('Verified M3.3 plan not found');
  verifyPreparedPlan(record.plan);
  return record.plan;
}
async function currentPositionRaw(): Promise<string | null> {
  const controller = new AbortController();
  const sdk = new SomniaMarkets({ chain: hidekiTestnet,
    wsRpcUrl: 'wss://api.hideki2.infra.testnet.somnia.network/ws',
    indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql',
    addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, signal: controller.signal });
  try { return await withSnapshotSdk(sdk, controller, async () =>
    (await sdk.client.getPerpPosition({ marginBank: HIDEKI_MARGIN_BANK as Address,
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
async function main(): Promise<void> {
  const [operation, hash, txHash] = process.argv.slice(2);
  if (!['execute', 'reconcile'].includes(operation ?? '') || !hash ||
    (operation === 'execute' && txHash) || (operation === 'reconcile' && !txHash))
    throw Error('Usage: npm run bot-execute -- execute <plan-hash> | reconcile <plan-hash> <tx-hash>');
  const plan = await loadPlan(hash);
  const keystore = await readBotKeystore();
  if (!keystore || !same(keystore.address, plan.operator)) throw Error('Local bot address differs from saved plan');
  if (operation === 'reconcile') {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash!)) throw Error('Invalid transaction hash');
    const history = await readExecutionLedger(ledgerDir, plan.intentId);
    if (!history.some(entry => entry.txHash && same(entry.txHash, txHash!)))
      throw Error('Transaction hash does not belong to this reserved plan');
    const evidence = await forensicRead(txHash as Hex);
    if (!evidence) throw Error('Receipt unavailable; execution state remains UNKNOWN');
    const forensic = assessDelegatedTrade(plan, evidence.body, evidence.currentPositionRaw);
    await saveForensicEvidence(forensicDir, forensic);
    await appendExecutionState(ledgerDir, plan.intentId, plan.hash, forensic.verdict, txHash!);
    console.log(JSON.stringify({ state: forensic.verdict, txHash, forensicHash: forensic.hash, reasons: forensic.reasons }));
    return;
  }
  console.log(JSON.stringify({ planHash: plan.hash, status: plan.status, chainId: plan.chainId,
    owner: plan.owner, operator: plan.operator, pool: plan.pool, side: plan.side,
    price: plan.price, quantity: plan.quantity, notionalWei: plan.risk.orderNotionalWei,
    gasLimit: plan.risk.gasLimit, gasBudgetWei: plan.risk.maxGasCostWei,
    expiresAt: plan.expiresAt, blockers: plan.blockers }, null, 2));
  const ports: ExecutionPorts = {
    fresh: () => inspectTradingAuthorization({ tradingWallet: OWNER_TRADING_WALLET,
      operator: keystore.address, pool: BTC_POOL, side: plan.side, price: plan.price, quantity: plan.quantity }),
    chainId: () => client.getChainId(),
    nonce: tag => client.getTransactionCount({ address: keystore.address as Address, blockTag: tag }),
    gasPrice: () => client.getGasPrice(),
    gasBalance: () => client.getBalance({ address: keystore.address as Address }),
    estimateOriginal: p => client.estimateGas({ account: keystore.address as Address,
      to: BTC_POOL as Address, data: p.transaction!.data, value: 0n }),
    confirm: async p => (await promptText(`Type EXECUTE ${p.hash} to authorize this one Hideki order: `)) === `EXECUTE ${p.hash}`,
    sign: async (transaction, expected) => {
      let password = await promptHidden('Local bot keystore password: ');
      try {
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
          operator: keystore.address, pool: BTC_POOL, side: plan.side, price: plan.price, quantity: plan.quantity });
        const simulatedGas = await client.estimateGas({ account: keystore.address as Address,
          to: BTC_POOL as Address, data: plan.transaction!.data, value: 0n });
        const final = assessExecutionPreflight(plan, permission, { chainId: await client.getChainId(),
          latestNonce: latest, pendingNonce: pending, gasPrice: freshGasPrice,
          gasBalance: balance, simulatedGas, now: Date.now() });
        if (!final.passed) throw Error(`Final pre-sign check failed: ${final.blockers.join('; ')}`);
        return await withUnlockedBotSigner(keystore, password, async signer => {
          if (!same(signer.address, expected)) throw Error('Signer address mismatch');
          return signer.signTransaction(transaction);
        });
      } finally { password = ''; }
    },
    verifySigned: verifySignedBotTransaction,
    broadcastOnce: raw => client.sendRawTransaction({ serializedTransaction: raw }),
    receiptAndForensics: async tx => {
      await client.waitForTransactionReceipt({ hash: tx, timeout: 45_000, pollingInterval: 1500 });
      return forensicRead(tx);
    },
  };
  const outcome = await executeDelegatedPlan(plan, ports, { ledger: ledgerDir, forensics: forensicDir });
  console.log(JSON.stringify(outcome));
}
try { await main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : 'Local execution failed; inspect ledger before retrying');
  process.exitCode = 1;
}

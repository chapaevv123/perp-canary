import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createPublicClient, formatUnits, http, getAddress } from 'viem';
import { readBotKeystore } from '../src/bot-keystore.ts';
import { inspectTradingAuthorization } from '../src/trading-authorization.ts';
import { buildPreparedPlan, positionEffect, verifyPreparedPlan } from '../src/delegated-plan.ts';
import { assessExecutionPreflight } from '../src/delegated-execution.ts';
import { readExecutionLedger } from '../src/execution-ledger.ts';
import { BTC_POOL, OWNER_TRADING_WALLET } from '../src/trade-forensics.ts';
import { RPC } from '../src/rpc-health.ts';
import { resolve } from 'node:path';

// Read-only, ephemeral report. Never writes a plan, unlocks a key, signs or broadcasts.
const keystore = await readBotKeystore();
if (!keystore) throw Error('Existing bot keystore metadata unavailable');
const bot = getAddress(keystore.address);
const client = createPublicClient({ chain: hidekiTestnet, transport: http(RPC, { timeout: 15_000, retryCount: 0 }) });
const sdk = new SomniaMarkets({ chain: hidekiTestnet,
  wsRpcUrl: 'wss://api.hideki2.infra.testnet.somnia.network/ws',
  indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql',
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES });
try {
  const [chainId, latestNonce, pendingNonce, gasWei, gasPriceWei, markets] = await Promise.all([
    client.getChainId(), client.getTransactionCount({ address: bot, blockTag: 'latest' }),
    client.getTransactionCount({ address: bot, blockTag: 'pending' }),
    client.getBalance({ address: bot }), client.getGasPrice(), sdk.client.listPerpMarkets(),
  ]);
  const market = markets.find(row => row.poolAddress.toLowerCase() === BTC_POOL.toLowerCase());
  if (!market) throw Error('BTC-PERP pool missing from current market rows');
  const [book, position] = await Promise.all([
    sdk.client.getBookTopsOnchain([{ id: market.poolAddress, poolAddress: market.poolAddress }]),
    sdk.client.getPerpPosition({ marginBank: market.marginBank, account: getAddress(OWNER_TRADING_WALLET), pool: market.poolAddress }),
  ]);
  const summary: Record<string, unknown> = { mode: 'LIVE_READ_ONLY', observedAt: new Date().toISOString(),
    chainId, bot, owner: OWNER_TRADING_WALLET, latestNonce, pendingNonce,
    gasStt: formatUnits(gasWei, 18), gasPriceWei: gasPriceWei.toString(),
    market: { pool: market.poolAddress, marginBank: market.marginBank,
      baseDecimals: market.baseDecimals, quoteDecimals: market.quoteDecimals,
      tickSize: market.tickSize.toString(), lotSize: market.lotSize.toString(),
      minQuantity: market.minQuantity.toString(), minQuantityBtc: formatUnits(BigInt(market.minQuantity), market.baseDecimals) },
    book: JSON.parse(JSON.stringify(book, (_key, value) => typeof value === 'bigint' ? value.toString() : value)),
    positionSizeRaw: position.size.toString(), positionBtc: formatUnits(position.size, market.baseDecimals),
  };
  const price = process.argv[2];
  const quantity = process.argv[3] ?? formatUnits(BigInt(market.minQuantity), market.baseDecimals);
  if (price) {
    const observation = await inspectTradingAuthorization({ tradingWallet: OWNER_TRADING_WALLET,
      operator: bot, pool: BTC_POOL, side: 'BUY', price, quantity });
    const plan = buildPreparedPlan(observation, { side: 'BUY', price, quantity });
    verifyPreparedPlan(plan);
    const priorIntent = await readExecutionLedger(resolve('bot-execution-ledger'), plan.intentId);
    const dryRun = plan.status === 'PREPARED' ? assessExecutionPreflight(plan, observation, {
      chainId, latestNonce, pendingNonce, gasPrice: gasPriceWei, gasBalance: gasWei,
      simulatedGas: BigInt(observation.estimatedGasUnits), now: Date.now(),
    }) : null;
    summary.preflight = { observedAt: observation.observedAt, sampledBlock: observation.sampledBlock,
      permissions: observation.permissions, marketSupported: observation.marketSupported,
      marginBankUnlocked: observation.marginBankUnlocked, marginSufficient: observation.marginSufficient,
      simulation: observation.simulation, simulationFailure: observation.simulationFailure,
      blockers: observation.planBlockers, estimatedGasUnits: observation.estimatedGasUnits,
      markPriceRaw: observation.markPriceRaw };
    summary.ephemeralPlan = { hash: plan.hash, status: plan.status, expiresAt: plan.expiresAt,
      intentId: plan.intentId, target: plan.transaction?.to ?? null, calldata: plan.transaction?.data ?? null,
      quantity: plan.quantity, price: plan.price, positionSizeBeforeRaw: plan.positionSizeBeforeRaw,
      positionEffect: /^-?\d+$/.test(plan.positionSizeBeforeRaw) ?
        positionEffect(plan.side, plan.quantity, plan.positionSizeBeforeRaw) : null,
      risk: plan.risk, checks: plan.checks, blockers: plan.blockers,
      dryRunPreflight: dryRun, idempotency: priorIntent.length ? 'INTENT_ALREADY_RESERVED' : 'UNRESERVED',
      disclaimer: 'Ephemeral observation only. This plan is not stored and cannot be executed later.' };
  }
  console.log(JSON.stringify(summary, null, 2));
} finally { sdk.close(); }

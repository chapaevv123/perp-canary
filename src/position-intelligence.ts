import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { formatUnits, getAddress, isAddress } from 'viem';
import { withSnapshotSdk } from './lifecycle.ts';
import { verifiedMarket } from './market-registry.ts';
import { KNOWN_EMBEDDED } from './wallet-funding.ts';

export function scenarioPnl(sizeRaw: bigint, entryRaw: bigint, markRaw: bigint,
  baseDecimals: number, percentBps: number) {
  if (!Number.isInteger(percentBps) || Math.abs(percentBps) > 5000) throw Error('Scenario must be within -50% to +50%');
  const targetRaw = markRaw * BigInt(10_000 + percentBps) / 10_000n;
  const estimateRaw = sizeRaw * (targetRaw - entryRaw) / 10n ** BigInt(baseDecimals);
  return { targetPrice: formatUnits(targetRaw, 18), estimatedPnlUsdso: formatUnits(estimateRaw, 18),
    note: 'Price-only scenario against entry. Excludes future funding, fees, liquidation and position changes.' };
}

export async function readPositionIntelligence(accountInput: string, mode: string, marketInput: string) {
  if (!isAddress(accountInput, { strict: false })) throw Error('Valid connected wallet required');
  if (mode !== 'DIRECT' && mode !== 'DELEGATED_PERPS') throw Error('Valid account mode required');
  const operator = getAddress(accountInput);
  const owner = mode === 'DELEGATED_PERPS' ? KNOWN_EMBEDDED : operator;
  const market = await verifiedMarket(marketInput);
  const controller = new AbortController();
  const sdk = new SomniaMarkets({ chain: hidekiTestnet,
    wsRpcUrl: 'wss://api.hideki2.infra.testnet.somnia.network/ws',
    indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql',
    addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, signal: controller.signal });
  const snapshot = await withSnapshotSdk(sdk, controller,
    () => sdk.client.accountPositions.getSnapshot(market.marginBank, owner),
    () => 'reading pinned account-position intelligence', 35_000);
  if (snapshot.chainId !== 50383 || snapshot.account.toLowerCase() !== owner.toLowerCase() ||
    snapshot.marginBank.toLowerCase() !== market.marginBank.toLowerCase())
    throw Error('Position snapshot identity differs from selected account or chain');
  const position = snapshot.data.positions.find(row => row.pool.toLowerCase() === market.pool.toLowerCase());
  const marks = position?.marks;
  const liquidation = position?.liquidationPrice;
  const scenario = position && marks?.status === 'known' ?
    [-1000, -500, 0, 500, 1000].map(bps => ({ percent: bps / 100,
      ...scenarioPnl(position.size, position.avgEntryPrice, marks.markPrice, market.baseDecimals, bps) })) : [];
  return { source: 'OFFICIAL_SDK_PINNED_ON_CHAIN_ACCOUNT_POSITIONS', chainId: snapshot.chainId,
    mode, operator, owner, market: market.symbol, pool: market.pool,
    block: snapshot.data.blockNumber.toString(), observedAt: new Date(snapshot.data.observedAtMs).toISOString(),
    availableMarginUsdso: formatUnits(snapshot.data.margin.unlockedCollateralBalance, 18),
    direction: !position ? 'FLAT' : position.size > 0n ? 'LONG' : 'SHORT',
    size: position ? formatUnits(position.size, market.baseDecimals) : '0',
    entryPrice: position ? formatUnits(position.avgEntryPrice, market.quoteDecimals) : null,
    markPrice: marks?.status === 'known' ? formatUnits(marks.markPrice, market.quoteDecimals) : null,
    unrealizedPnlUsdso: marks?.status === 'known' ? formatUnits(marks.unrealizedPnl, 18) : null,
    accruedFundingOwedUsdso: marks?.status === 'known' ? formatUnits(marks.accruedFunding, 18) : null,
    liquidationPrice: liquidation?.status === 'known' && liquidation.value !== null ?
      formatUnits(liquidation.value, market.quoteDecimals) : null,
    liquidationReason: !position ? 'No position' : liquidation?.status === 'known' ?
      'No single-market liquidation price' : liquidation?.reason ?? 'Unavailable',
    realizedPnlUsdso: null, realizedPnlReason: 'Cumulative realized PnL is not supplied by this pinned position snapshot',
    metricsStatus: !position ? 'FLAT' : marks?.status === 'known' ? 'AVAILABLE' : 'UNAVAILABLE',
    metricsReason: marks?.status === 'unknown' ? marks.reason : null,
    scenarioInputs: position && marks?.status === 'known' ? {
      sizeRaw: position.size.toString(), entryRaw: position.avgEntryPrice.toString(),
      markRaw: marks.markPrice.toString(), baseDecimals: market.baseDecimals } : null,
    scenario };
}

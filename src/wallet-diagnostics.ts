import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES, orderBookEventsAbi, perpPoolWriteAbi } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createPublicClient, decodeEventLog, decodeFunctionData, formatUnits, getAddress, http, isAddress, type Address, type Hex } from 'viem';
import { RPC, readRpcHead } from './rpc-health.ts';
import { withSnapshotSdk } from './lifecycle.ts';

const WSS = 'wss://api.hideki2.infra.testnet.somnia.network/ws';
const INDEXER = 'https://hideki-dev.smk.somnia.host/v1/graphql';
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ERC20_BALANCE = [{ type: 'function', name: 'balanceOf', stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }] as const;
const SAFE_IS_OWNER = [{ type: 'function', name: 'isOwner', stateMutability: 'view',
  inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'bool' }] }] as const;

export type Fact = { value: string; status: 'CONFIRMED' | 'SUPPLIED' | 'UNKNOWN'; source: string };
export const unknown = (source: string): Fact => ({ value: 'UNKNOWN', status: 'UNKNOWN', source });
const confirmed = (value: string, source: string): Fact => ({ value, status: 'CONFIRMED', source });
export class WalletDiagnosticsReadError extends Error {
  readonly phase: string;
  constructor(phase: string) {
    super(`Wallet diagnostics read unavailable during ${phase}; no balance should be inferred`);
    this.name = 'WalletDiagnosticsReadError';
    this.phase = phase;
  }
}
export function canonicalWalletAddress(value: string, label: string): Address {
  if (!isAddress(value, { strict: false })) throw new Error(`${label} must be an EVM address`);
  return getAddress(value);
}

export function walletRoles(eoa: string | undefined, trading: string | undefined): {
  connectedEoa: Fact; tradingAccount: Fact; executionSigner: Fact; gasPayer: Fact; collateralOwner: Fact; relationship: Fact;
} {
  return {
    connectedEoa: eoa ? { value: eoa, status: 'SUPPLIED', source: 'Browser EIP-1193 account or user input; not a dreamDEX account lookup' }
      : unknown('Connect a browser wallet or enter a public EOA'),
    tradingAccount: trading ? { value: trading, status: 'SUPPLIED', source: 'User supplied dreamDEX wallet address; linkage unverified' }
      : unknown('dreamDEX wallet address is not derivable from the connected EOA through this SDK'),
    executionSigner: unknown('A transaction hash can identify the outer on-chain sender; app embedded signer is not exposed'),
    gasPayer: unknown('Requires a specific transaction hash; app-wallet gas source is not inferred from EOA balance'),
    collateralOwner: trading ? { value: trading, status: 'SUPPLIED', source: 'MarginBank read below is keyed to this supplied address' }
      : unknown('Trading account address is unconfirmed'),
    relationship: unknown('No authenticated dreamDEX login-to-wallet mapping was queried'),
  };
}

export async function inspectWalletArchitecture(input: { eoa?: string; tradingAccount?: string; pool: string; txHash?: string }) {
  if (input.txHash && !TX_HASH.test(input.txHash)) throw new Error('Transaction hash must be 0x plus 64 hex characters');
  if (!input.eoa && !input.tradingAccount && !input.txHash) throw new Error('Enter an EOA, trading account or transaction hash');
  input = { ...input, eoa: input.eoa ? canonicalWalletAddress(input.eoa, 'EOA') : undefined,
    tradingAccount: input.tradingAccount ? canonicalWalletAddress(input.tradingAccount, 'Trading account') : undefined,
    pool: canonicalWalletAddress(input.pool, 'Perp pool') };
  const head = await readRpcHead();
  const roles = walletRoles(input.eoa, input.tradingAccount);
  const controller = new AbortController();
  const sdk = new SomniaMarkets({ chain: hidekiTestnet, wsRpcUrl: WSS, indexerUrl: INDEXER,
    addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, signal: controller.signal });
  let phase = 'reading selected market';
  try { return await withSnapshotSdk(sdk, controller, async () => {
    const market = (await sdk.client.listPerpMarkets()).find(row => row.poolAddress.toLowerCase() === input.pool.toLowerCase());
    if (!market) throw new Error('Pool is absent from current perp market rows');
    const system = await sdk.client.getPerpSystemConfig(market.marginBank);
    const client = sdk.client.getViemClient();
    const accounts = [];
    for (const [role, address] of [['EOA', input.eoa], ['TRADING_ACCOUNT', input.tradingAccount]] as const) {
      if (!address) continue;
      phase = `reading ${role} balances and MarginBank`;
      const account = address as Address;
      const [gas, walletUsdso, margin, position] = await Promise.all([
        client.getBalance({ address: account }),
        client.readContract({ address: system.collateralToken, abi: ERC20_BALANCE,
          functionName: 'balanceOf', args: [account] }),
        sdk.client.getMarginAccount(market.marginBank, account),
        sdk.client.getPerpPosition({ marginBank: market.marginBank, pool: market.poolAddress, account }),
      ]);
      const portfolio = await sdk.client.getPerpPortfolio(account, { ordersLimit: 50, tradesLimit: 0 })
        .then(value => confirmed(String(value.openOrders.filter(order =>
          order.market.poolAddress.toLowerCase() === market.poolAddress.toLowerCase()).length),
        `Markets SDK indexed getPerpPortfolio; selected pool; up to 50 open orders; may lag chain`))
        .catch(() => unknown('Indexer portfolio read failed; no zero-order claim'));
      accounts.push({ role, address, gasStt: confirmed(formatUnits(gas, 18), 'Hideki eth_getBalance for this address'),
        walletUsdso: confirmed(formatUnits(walletUsdso, market.quoteDecimals), 'USDso ERC-20 balanceOf for this address'),
        marginBankUnlocked: confirmed(formatUnits(margin.unlockedCollateralBalance, market.quoteDecimals),
          `Markets SDK getMarginAccount; MarginBank ${market.marginBank}; block ${margin.asOfBlock}`),
        marginBankLocked: confirmed(formatUnits(margin.lockedCollateral, market.quoteDecimals),
          `Markets SDK getMarginAccount; block ${margin.asOfBlock}`),
        positionSize: confirmed(formatUnits(position.size, market.baseDecimals),
          `Markets SDK getPerpPosition; pool ${market.poolAddress}`),
        activePerpPools: confirmed(margin.activePerpPools.length ? margin.activePerpPools.join(', ') : 'none',
          `Markets SDK getMarginAccount; active perp pools across markets; block ${margin.asOfBlock}`),
        openOrdersObserved: portfolio,
        marginStatus: confirmed(margin.marginStatus, `Markets SDK getMarginAccount; block ${margin.asOfBlock}`),
      });
    }
    if (input.eoa && input.tradingAccount) {
      phase = 'checking public smart-account ownership';
      try {
        const isOwner = await client.readContract({ address: input.tradingAccount as Address,
          abi: SAFE_IS_OWNER, functionName: 'isOwner', args: [input.eoa as Address] });
        roles.relationship = confirmed(isOwner ? 'EOA is an on-chain owner of supplied smart account' : 'EOA is not an on-chain owner via isOwner',
          `isOwner(${input.eoa}) on ${input.tradingAccount}; does not verify dreamDEX login linkage`);
      } catch { /* Unknown smart-account ABI or unavailable read does not prove a negative. */ }
    }
    let transaction: Awaited<ReturnType<typeof inspectTransaction>> | null = null;
    if (input.txHash) {
      phase = 'inspecting existing transaction';
      transaction = await inspectTransaction(input.txHash as Hex, market.poolAddress);
      roles.gasPayer = confirmed(transaction.outerSender, `Hideki transaction ${input.txHash} from; network gas payer`);
      if (transaction.route === 'DIRECT_POOL_CALL')
        roles.executionSigner = confirmed(transaction.outerSender, `Direct PerpPool transaction ${input.txHash} from`);
      if (transaction.orderOwners.length === 1) {
        roles.tradingAccount = confirmed(transaction.orderOwners[0]!, `PerpPool OrderPlaced owner event in ${input.txHash}`);
        roles.collateralOwner = confirmed(transaction.orderOwners[0]!, `PerpPool OrderPlaced owner event in ${input.txHash}`);
      }
    }
    return { schema: 'perp-canary/wallet-diagnostics/v1', mode: 'LIVE_READ_ONLY', observedAt: new Date().toISOString(),
      chainId: head.chainId, sampledBlock: head.blockNumber, pool: market.poolAddress, marginBank: market.marginBank,
      collateralToken: system.collateralToken, roles, accounts, transaction,
      limitations: ['The two account balances are independent and are never combined.',
        'A user-supplied trading address is not proof that it belongs to the connected EOA or dreamDEX login.',
        'MarginBank and position reads are current reads, not pinned to the sampled block or transaction receipt.'] };
  }, () => phase, 90_000); }
  catch (error) {
    if (error instanceof Error && error.message === 'Pool is absent from current perp market rows') throw error;
    throw new WalletDiagnosticsReadError(phase);
  }
}

export async function inspectTransaction(txHash: Hex, pool: string) {
  const client = createPublicClient({ chain: hidekiTestnet, transport: http(RPC, { timeout: 15_000, retryCount: 1 }) });
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: txHash }), client.getTransactionReceipt({ hash: txHash }),
  ]);
  let directCall: string | null = null;
  if (tx.to?.toLowerCase() === pool.toLowerCase()) {
    try { directCall = decodeFunctionData({ abi: perpPoolWriteAbi, data: tx.input }).functionName; }
    catch { /* Other pool calls remain unknown. */ }
  }
  const owners = new Set<string>();
  let poolLogCount = 0;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== pool.toLowerCase()) continue;
    poolLogCount++;
    try {
      const event = decodeEventLog({ abi: orderBookEventsAbi, data: log.data, topics: log.topics });
      if (event.eventName === 'OrderPlaced') {
        const placed = event.args.placedOrder as { owner?: string };
        if (placed.owner) owners.add(placed.owner.toLowerCase());
      }
    } catch { /* Keep the raw pool-log count; do not invent an owner. */ }
  }
  return { txHash, status: receipt.status, outerSender: tx.from, outerTarget: tx.to,
    gasUsed: receipt.gasUsed.toString(), directCall, orderOwners: [...owners], poolLogCount,
    route: directCall ? 'DIRECT_POOL_CALL' : poolLogCount > 0 ? 'CONTRACT_MEDIATED_OR_OTHER_CALL' : 'UNKNOWN',
    expectedVsActual: directCall ? 'REQUIRES_PREEXISTING_MATCHING_PLAN' : 'UNSUPPORTED_ROUTE_OR_NO_MATCHING_POOL_EVENTS' };
}

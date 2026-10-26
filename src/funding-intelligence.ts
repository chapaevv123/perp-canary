import { BridgeToken, getBridgeToken } from '@somnia-chain/markets-sdk/chains';
import { formatUnits, getAddress, isAddress, parseUnits } from 'viem';
import { inspectWalletArchitecture } from './wallet-diagnostics.ts';
import { NETWORK_REGISTRY, SOURCES } from './network-registry.ts';
import { probeIsFresh, probeNetwork, rpcRead, type NetworkProbe, type ProbeStatus, type RpcRead } from './network-probe.ts';

type Diagnostics = Awaited<ReturnType<typeof inspectWalletArchitecture>>;
export type FundingInput = { eoa?: string; tradingAccount?: string; pool?: string;
  reportedUiAmount?: string; reportedUiSymbol?: string };
export type FundingRoute = { id: string; sourceNetwork: string; destinationNetwork: string; asset: string;
  status: 'SUPPORTED' | 'UNSUPPORTED' | 'UNKNOWN'; availability: 'CONFIRMED' | 'UNKNOWN' | 'BLOCKED';
  requirements: string; risks: string; officialUrl: string; requiredUserAction: string };

const zero = (value: string | null): boolean => value !== null && /^0(?:\.0+)?$/.test(value);

export function assessFunding(probes: readonly NetworkProbe[], diagnostics: Diagnostics | null,
  tradingAccount: string | undefined, nowMs: number): { status: ProbeStatus; reasons: string[]; nextAction: string } {
  if (!tradingAccount) return { status: 'UNKNOWN', reasons: ['No public dreamDEX trading-wallet address was supplied'],
    nextAction: 'Copy the public active Wallet 1 address from dreamDEX; do not provide a key.' };
  const hideki = probes.find(probe => probe.chainId === 50383);
  if (!hideki || hideki.status === 'RPC_ERROR') return { status: 'RPC_ERROR', reasons: ['Hideki RPC could not be verified'],
    nextAction: 'Retry the read-only Hideki check after RPC recovers.' };
  if (hideki.status !== 'READY') return { status: 'UNSUPPORTED', reasons: ['RPC chain ID does not match Hideki 50383'],
    nextAction: 'Use a verified Hideki RPC; do not switch a wallet automatically.' };
  if (!probeIsFresh(hideki, nowMs)) return { status: 'UNKNOWN', reasons: ['Hideki balance sample is stale'],
    nextAction: 'Refresh read-only balances before assessing funding.' };
  const row = hideki.accounts.find(account => account.role === 'TRADING_WALLET' &&
    account.address.toLowerCase() === tradingAccount.toLowerCase());
  if (!row || row.native.status !== 'READY') return { status: 'RPC_ERROR', reasons: ['Trading-wallet STT balance was not read'],
    nextAction: 'Retry the read-only balance check; no zero balance is inferred.' };
  const margin = diagnostics?.accounts.find(account => account.role === 'TRADING_ACCOUNT' &&
    account.address.toLowerCase() === tradingAccount.toLowerCase());
  if (!margin || margin.marginBankUnlocked.status !== 'CONFIRMED') return { status: 'UNKNOWN',
    reasons: ['Trading-wallet MarginBank collateral is unverified'],
    nextAction: 'Inspect the trading wallet on Hideki and confirm its Perps account.' };
  const reasons: string[] = [];
  if (zero(row.native.value)) reasons.push('Trading wallet has no Hideki STT for gas');
  if (zero(margin.marginBankUnlocked.value)) reasons.push('Trading wallet has no unlocked USDso in Hideki MarginBank');
  if (reasons.length) return { status: 'BLOCKED', reasons,
    nextAction: 'Confirm the active dreamDEX trading wallet and check official Perps Arena credit or Perps margin in the app. No deposit is inferred.' };
  const voucherFloor = margin.voucherFloor;
  const credit = voucherFloor.status === 'CONFIRMED' && !zero(voucherFloor.value)
    ? `Voucher floor ${voucherFloor.value} USDso is present; paper-credit market restrictions apply` :
    'Voucher status is unverified; collateral type remains UNKNOWN';
  return { status: 'UNKNOWN', reasons: [`Hideki gas and free MarginBank margin exist. ${credit}. Active app-wallet signer, permitted market and order-specific preflight remain unverified`],
    nextAction: 'Confirm Wallet 1 maps to this public address, select a paper-credit-eligible market, and run an order-specific read-only preflight. No new deposit is indicated by these balances.' };
}

export function compareUiAmount(reported: string | undefined, symbol: string | undefined,
  probes: readonly NetworkProbe[]) {
  const label = symbol?.trim() || 'UNKNOWN';
  if (!reported) return { status: 'UNKNOWN', reported: null, matched: null,
    note: 'No user-reported UI amount was supplied' };
  if (!/^\d{1,24}(?:\.\d{1,18})?$/.test(reported)) throw new Error('Reported UI amount must be a nonnegative decimal');
  const precision = reported.split('.')[1]?.length ?? 0;
  const scale = 10n ** BigInt(18 - precision);
  const reportedUnits = parseUnits(reported, 18);
  for (const probe of probes) for (const account of probe.accounts) {
    if (account.role !== 'LOGIN_WALLET' || account.native.status !== 'READY' || !account.native.value) continue;
    if (account.native.raw && BigInt(account.native.raw) / scale === reportedUnits / scale)
      return { status: 'MATCHED_MAGNITUDE', reported: `${reported} ${label}`,
      matched: { chainId: probe.chainId, address: account.address, value: account.native.value,
        nativeSymbol: NETWORK_REGISTRY.find(network => network.chainId === probe.chainId)?.tokenMetadata[0]?.symbol ?? 'UNKNOWN' },
      note: 'Numerical match only; UI token label and actual chain must be checked separately' };
  }
  return { status: 'UNVERIFIED', reported: `${reported} ${label}`, matched: null,
    note: 'No sampled native balance for the login wallet matches the displayed amount' };
}

export function fundingRoutes(diagnostics: Diagnostics | null, bridgeLiquidity: string | null): FundingRoute[] {
  const sttRoute = getBridgeToken(BridgeToken.STT, 50312);
  const voucher = diagnostics?.accounts.find(account => account.role === 'TRADING_ACCOUNT')?.voucherEligibility;
  const voucherFloor = diagnostics?.accounts.find(account => account.role === 'TRADING_ACCOUNT')?.voucherFloor;
  const existingVoucher = voucherFloor?.status === 'CONFIRMED' && !zero(voucherFloor.value);
  return [
    { id: 'shannon-faucet', sourceNetwork: 'Somnia testnet faucet', destinationNetwork: 'Shannon 50312', asset: 'STT',
      status: 'SUPPORTED', availability: 'UNKNOWN', requirements: 'Public Shannon address; faucet limits and current UI must be checked by owner',
      risks: 'A faucet claim is not a Hideki deposit', officialUrl: SOURCES.somnia,
      requiredUserAction: 'Open the official Somnia testnet faucet if more Shannon STT is needed; no claim is made here.' },
    { id: 'sdk-test-bridge', sourceNetwork: 'Shannon 50312', destinationNetwork: 'Hideki 50383', asset: 'STT',
      status: sttRoute?.destinations.includes(50383) ? 'SUPPORTED' : 'UNSUPPORTED',
      availability: bridgeLiquidity && !zero(bridgeLiquidity) ? 'UNKNOWN' : bridgeLiquidity === null ? 'UNKNOWN' : 'BLOCKED',
      requirements: 'Owner-controlled source address, destination address, destination router liquidity and live relayer',
      risks: `Dev/test bridge (single validator); destination router STT ${bridgeLiquidity ?? 'UNKNOWN'}; relayer delivery not verified`,
      officialUrl: SOURCES.bridge,
      requiredUserAction: 'Review the official SDK bridge route and current liquidity before any separately approved transfer.' },
    { id: 'dreamdex-deposit', sourceNetwork: 'UI label: Somnia Testnet (chain ID UNKNOWN)',
      destinationNetwork: 'dreamDEX Wallet 1 (chain ID UNKNOWN until app evidence)', asset: 'UI label: SOMI',
      status: 'UNKNOWN', availability: 'UNKNOWN',
      requirements: 'Verify source and destination chain IDs, asset contract/native type and app route; owner reports USDso deposits paused',
      risks: 'UI labels do not prove Shannon, Hideki or Mainnet; no deposit success is inferred',
      officialUrl: 'https://app.testnet.dreamdex.io/docs/welcome/making-your-first-deposit',
      requiredUserAction: 'Inspect chain IDs and deposit preview in the official app; do not confirm a transfer from Perp Canary.' },
    { id: 'perps-arena', sourceNetwork: 'dreamDEX Perps Arena programme', destinationNetwork: 'Hideki MarginBank 50383',
      asset: 'paper USDso voucher', status: 'SUPPORTED',
      availability: existingVoucher || voucher?.status === 'CONFIRMED' && voucher.value.startsWith('ELIGIBLE') ? 'CONFIRMED' : 'UNKNOWN',
      requirements: 'Account eligibility, supported market and owner action in official app',
      risks: 'Voucher is restricted, non-withdrawable credit; claim/deposit is not automatic', officialUrl: SOURCES.paper,
      requiredUserAction: existingVoucher ? 'Existing voucher floor is on-chain; verify market eligibility and app-wallet identity before preflight.' :
        'Check the official Perps Arena credit for the confirmed trading wallet; no claim is made here.' },
  ];
}

export async function collectFundingIntelligence(input: FundingInput, read: RpcRead = rpcRead) {
  if (!input.eoa && !input.tradingAccount) throw new Error('Enter a public EOA or trading wallet');
  for (const value of [input.eoa, input.tradingAccount]) {
    if (value && !isAddress(value, { strict: false })) throw new Error('Wallet addresses must be public EVM addresses');
  }
  if (input.pool && !isAddress(input.pool, { strict: false })) throw new Error('Perp pool must be a public EVM address');
  if (input.reportedUiAmount && !/^\d{1,24}(?:\.\d{1,18})?$/.test(input.reportedUiAmount))
    throw new Error('Reported UI amount must be a nonnegative decimal');
  const eoa = input.eoa ? getAddress(input.eoa) : undefined;
  const tradingAccount = input.tradingAccount ? getAddress(input.tradingAccount) : undefined;
  const probes = await Promise.all(NETWORK_REGISTRY.map(network => probeNetwork(network, { eoa, tradingAccount }, read)));
  let diagnostics: Diagnostics | null = null;
  let diagnosticsStatus: ProbeStatus = 'UNKNOWN';
  if (input.pool) {
    try { diagnostics = await inspectWalletArchitecture({ eoa, tradingAccount, pool: input.pool }); diagnosticsStatus = 'READY'; }
    catch { diagnosticsStatus = 'RPC_ERROR'; }
  }
  const hideki = probes.find(probe => probe.chainId === 50383);
  const router = getBridgeToken(BridgeToken.STT, 50383)?.router;
  let bridgeLiquidity: string | null = null;
  if (hideki?.status === 'READY' && router) {
    try {
      const value = await read(hideki.rpc, 'eth_getBalance', [router, 'latest']);
      if (typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value))
        bridgeLiquidity = formatUnits(BigInt(value), 18);
    } catch { /* Relayer and router availability remain unknown. */ }
  }
  const readiness = assessFunding(probes, diagnostics, tradingAccount, Date.now());
  return { schema: 'perp-canary/funding-intelligence/v1', mode: 'LIVE_READ_ONLY', observedAt: new Date().toISOString(),
    activePerpsNetwork: 50383, networkRegistry: NETWORK_REGISTRY, probes,
    networkCompatibility: NETWORK_REGISTRY.map(network => ({ chainId: network.chainId,
      status: network.chainId === 50383 ? readiness.status : 'UNSUPPORTED',
      reason: network.chainId === 50383 ? `Verified Hideki perp deployment; account readiness ${readiness.status}` :
        'No verified perps deployment on this network' })),
    diagnosticsStatus, perps: diagnostics ? { roles: diagnostics.roles, accounts: diagnostics.accounts,
      pool: diagnostics.pool, marginBank: diagnostics.marginBank } : null,
    uiAmountComparison: compareUiAmount(input.reportedUiAmount, input.reportedUiSymbol, probes),
    fundingReadiness: readiness, routes: fundingRoutes(diagnostics, bridgeLiquidity),
    appBalances: { global: 'UNKNOWN', spot: 'UNKNOWN', source: 'No authenticated public SDK mapping to dreamDEX Global/Spot UI balances' },
    limitations: ['No balances are added across addresses or networks.', 'A user-reported UI token label is not chain or asset proof.',
      'RPC read failures and stale samples are not zero balances.', 'No bridge, claim, deposit, approval, swap or trade was sent.'] };
}

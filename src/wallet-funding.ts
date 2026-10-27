import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createPublicClient, formatUnits, getAddress, http, isAddress, parseAbi, parseUnits,
  toFunctionSelector, type Address, type Hex } from 'viem';
import { withSnapshotSdk } from './lifecycle.ts';
import { RPC } from './rpc-health.ts';

export const HIDEKI_BANK = getAddress('0x478769E1177C0773c43A593DCCc4Ad15F15F1394');
export const HIDEKI_USDSO = getAddress('0xed7993A74dAe1e6656B704A424DcD8711aAf4F72');
export const HIDEKI_VOUCHER = getAddress('0x2ACD9EFdA721450906bfE1bef3edE269636E42C4');
export const HIDEKI_BTC_POOL = getAddress('0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0');
export const EXPECTED_METAMASK = getAddress('0x6Fa3659a15e9264E43EC67Fe4bB5d31D38109A42');
export const KNOWN_EMBEDDED = getAddress('0xE350c75b3B152CC5481FFE13c8078Ab35c90b20f');
const client = createPublicClient({ chain: hidekiTestnet, transport: http(RPC, { timeout: 15_000, retryCount: 1 }) });
const ercAbi = parseAbi(['function balanceOf(address) view returns (uint256)']);
const bankAbi = parseAbi(['function isVoucherMarketAllowed(address) view returns (bool)']);
const safeAbi = parseAbi(['function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)', 'function isOwner(address) view returns (bool)']);
const claimAbi = parseAbi(['function claim()']);
const CLAIM_SELECTOR = toFunctionSelector(claimAbi[0]!);
const GAS_CAP = 10n ** 17n;
const checkedAddress = (value: string): Address => {
  if (!isAddress(value, { strict: false })) throw Error('Valid connected EVM address required');
  return getAddress(value);
};
async function withSdk<T>(work: (sdk: SomniaMarkets) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const sdk = new SomniaMarkets({ chain: hidekiTestnet,
    wsRpcUrl: 'wss://api.hideki2.infra.testnet.somnia.network/ws',
    indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql',
    addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, signal: controller.signal });
  return withSnapshotSdk(sdk, controller, () => work(sdk), () => 'reading Hideki funding', 45_000);
}
export async function readWalletFunding(rawAccount: string) {
  const account = checkedAddress(rawAccount);
  const [chainId, block, gas, walletUsdso, code, sdkReads] = await Promise.all([
    client.getChainId(), client.getBlockNumber(), client.getBalance({ address: account }),
    client.readContract({ address: HIDEKI_USDSO, abi: ercAbi, functionName: 'balanceOf', args: [account] }),
    client.getCode({ address: account }),
    withSdk(async sdk => Promise.all([
      sdk.client.getPerpVoucherCampaign(HIDEKI_BANK),
      sdk.client.getPerpVoucherEligibility(HIDEKI_BANK, account),
      sdk.client.getPerpVoucher(HIDEKI_BANK, account),
      sdk.client.getMarginAccount(HIDEKI_BANK, account),
    ])),
  ]);
  if (chainId !== 50383) throw Error('Hideki RPC chain mismatch');
  const [campaign, eligibility, voucher, margin] = sdkReads;
  if (campaign && (campaign.distributor.toLowerCase() !== HIDEKI_VOUCHER.toLowerCase() ||
    campaign.collateralToken.toLowerCase() !== HIDEKI_USDSO.toLowerCase()))
    throw Error('Voucher campaign wiring differs from official Hideki deployment');
  const btcVoucherAllowed = await client.readContract({ address: HIDEKI_BANK, abi: bankAbi,
    functionName: 'isVoucherMarketAllowed', args: [HIDEKI_BTC_POOL] });
  return { account, chainId, block: block.toString(), observedAt: new Date().toISOString(),
    accountType: code && code !== '0x' ? 'CONTRACT' : 'EOA',
    identity: account.toLowerCase() === EXPECTED_METAMASK.toLowerCase() ? 'EXPECTED_EXTERNAL_METAMASK' :
      account.toLowerCase() === KNOWN_EMBEDDED.toLowerCase() ? 'KNOWN_DREAMDEX_SMART_ACCOUNT' : 'OTHER_ACCOUNT',
    nativeStt: formatUnits(gas, 18), nativeSttWei: gas.toString(),
    walletUsdso: formatUnits(walletUsdso, 18), walletUsdsoRaw: walletUsdso.toString(),
    marginFreeUsdso: formatUnits(margin.unlockedCollateralBalance, 18),
    marginWithdrawableUsdso: formatUnits(margin.withdrawable, 18),
    voucher: voucher ? { claimed: voucher.claimed, floorUsdso: formatUnits(voucher.floor, 18),
      expiresAt: voucher.expiresAt.toString() } : null,
    campaign: campaign ? { distributor: campaign.distributor,
      grantUsdso: formatUnits(campaign.grantAmount, 18),
      claimsRemaining: campaign.claimsRemaining.toString(),
      startsAt: campaign.startsAt.toString(), endsAt: campaign.endsAt.toString(),
      expiryDurationSec: campaign.expiryDurationSec.toString() } : null,
    eligibility: eligibility.eligible ? { eligible: true, grantUsdso: formatUnits(eligibility.grantAmount, 18) } :
      { eligible: false, reason: eligibility.reason },
    btcVoucherAllowed };
}
export async function readEmbeddedOwnership() {
  const [code, owners, threshold, metaMaskIsOwner] = await Promise.all([
    client.getCode({ address: KNOWN_EMBEDDED }),
    client.readContract({ address: KNOWN_EMBEDDED, abi: safeAbi, functionName: 'getOwners' }),
    client.readContract({ address: KNOWN_EMBEDDED, abi: safeAbi, functionName: 'getThreshold' }),
    client.readContract({ address: KNOWN_EMBEDDED, abi: safeAbi, functionName: 'isOwner',
      args: [EXPECTED_METAMASK] }),
  ]);
  if (!code || code === '0x') throw Error('Known embedded account has no contract code');
  return { account: KNOWN_EMBEDDED, accountType: 'SAFE_COMPATIBLE_SMART_ACCOUNT',
    owners, threshold: threshold.toString(), metaMaskIsOwner,
    status: metaMaskIsOwner ? 'EXTERNAL_OWNER_CONFIRMED' : 'EXTERNAL_OWNER_NOT_AUTHORIZED' };
}
export async function prepareVoucherClaim(rawAccount: string) {
  const account = checkedAddress(rawAccount);
  const funding = await readWalletFunding(account);
  const blocker = voucherClaimBlocker(funding);
  if (blocker) throw Error(blocker);
  const data = CLAIM_SELECTOR;
  const [gas, gasPrice, nonce] = await Promise.all([
    client.estimateGas({ account, to: HIDEKI_VOUCHER, data, value: 0n }),
    client.getGasPrice(), client.getTransactionCount({ address: account, blockTag: 'pending' }),
  ]);
  const gasLimit = gas * 12n / 10n;
  const maxCost = gasLimit * gasPrice;
  if (maxCost > GAS_CAP || maxCost > BigInt(funding.nativeSttWei))
    throw Error('Claim gas exceeds wallet STT balance or 0.1 STT safety cap');
  return { status: 'READY_FOR_OWNER_CONFIRMATION' as const, account,
    grantUsdso: funding.eligibility.eligible ? funding.eligibility.grantUsdso : 'UNKNOWN', nonTransferable: true,
    transaction: { chainId: 50383, from: account, to: HIDEKI_VOUCHER, data,
      value: '0x0' as const, gas: `0x${gasLimit.toString(16)}`,
      nonce, maxGasCostStt: formatUnits(maxCost, 18) } };
}
export async function readVoucherClaimReceipt(hash: string, rawAccount: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw Error('Invalid transaction hash');
  const account = checkedAddress(rawAccount);
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: hash as Hex }).catch(error => {
      if (error instanceof Error && error.name === 'TransactionNotFoundError') return null;
      throw error;
    }),
    client.getTransactionReceipt({ hash: hash as Hex }).catch(error => {
      if (error instanceof Error && error.name === 'TransactionReceiptNotFoundError') return null;
      throw error;
    }),
  ]);
  if (!tx) return { state: 'PENDING' as const, hash };
  if (tx.from.toLowerCase() !== account.toLowerCase() ||
    tx.to?.toLowerCase() !== HIDEKI_VOUCHER.toLowerCase() || tx.input !== CLAIM_SELECTOR || tx.value !== 0n)
    throw Error('Transaction differs from reviewed voucher claim');
  if (!receipt) return { state: 'PENDING' as const, hash };
  if (receipt.status !== 'success') return { state: 'FAILED' as const, hash, block: receipt.blockNumber.toString() };
  const funding = await readWalletFunding(account);
  if (!funding.voucher?.claimed || parseUnits(funding.voucher.floorUsdso, 18) === 0n)
    return { state: 'UNKNOWN' as const, hash, block: receipt.blockNumber.toString(),
      reason: 'Receipt succeeded but voucher state is not independently confirmed' };
  return { state: 'CONFIRMED' as const, hash, block: receipt.blockNumber.toString(),
    voucherFloorUsdso: funding.voucher.floorUsdso, account: funding.account };
}
export function voucherClaimBlocker(funding: Awaited<ReturnType<typeof readWalletFunding>>): string | null {
  if (funding.chainId !== 50383 || funding.accountType !== 'EOA')
    return 'Direct injected-wallet claim requires an EOA on Hideki 50383';
  if (!funding.campaign || funding.campaign.distributor.toLowerCase() !== HIDEKI_VOUCHER.toLowerCase())
    return 'Verified Hideki voucher campaign unavailable';
  if (!funding.eligibility.eligible) return `Voucher ineligible: ${funding.eligibility.reason}`;
  if (BigInt(funding.nativeSttWei) === 0n)
    return 'No Hideki STT for gas. Use the official dreamDEX Link a Bot gas transfer flow first.';
  if (!funding.btcVoucherAllowed) return 'BTC-PERP is not allowed for this paper credit';
  return null;
}

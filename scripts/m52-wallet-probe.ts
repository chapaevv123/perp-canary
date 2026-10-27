import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createPublicClient, formatUnits, getAddress, http, parseAbi, toFunctionSelector } from 'viem';

const RPC = 'https://api.hideki2.infra.testnet.somnia.network';
const BANK = getAddress('0x478769E1177C0773c43A593DCCc4Ad15F15F1394');
const USD = getAddress('0xed7993A74dAe1e6656B704A424DcD8711aAf4F72');
const BTC = getAddress('0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0');
const accounts = [getAddress('0x6Fa3659a15e9264E43EC67Fe4bB5d31D38109A42'),
  getAddress('0xE350c75b3B152CC5481FFE13c8078Ab35c90b20f')];
const client = createPublicClient({ chain: hidekiTestnet, transport: http(RPC, { timeout: 15_000 }) });
const safeAbi = parseAbi(['function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)', 'function isOwner(address) view returns (bool)']);
const ercAbi = parseAbi(['function balanceOf(address) view returns (uint256)']);
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 60_000);
const sdk = new SomniaMarkets({ chain: hidekiTestnet,
  wsRpcUrl: 'wss://api.hideki2.infra.testnet.somnia.network/ws',
  indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql',
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, signal: controller.signal });
const maybe = async <T>(work: () => Promise<T>): Promise<T | { error: string }> => {
  try { return await work(); } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
};
try {
  const chainId = await client.getChainId();
  if (chainId !== 50383) throw Error(`Wrong chain ${chainId}`);
  const block = await client.getBlockNumber();
  const campaign = await maybe(() => sdk.client.getPerpVoucherCampaign(BANK));
  const output = await Promise.all(accounts.map(async account => {
    const [code, gas, usd, safeOwners, threshold, eoaIsOwner, margin, eligibility, voucher] = await Promise.all([
      client.getCode({ address: account }), client.getBalance({ address: account }),
      client.readContract({ address: USD, abi: ercAbi, functionName: 'balanceOf', args: [account] }),
      maybe(() => client.readContract({ address: account, abi: safeAbi, functionName: 'getOwners' })),
      maybe(() => client.readContract({ address: account, abi: safeAbi, functionName: 'getThreshold' })),
      maybe(() => client.readContract({ address: account, abi: safeAbi, functionName: 'isOwner', args: [accounts[0]!] })),
      maybe(() => sdk.client.getMarginAccount(BANK, account)),
      maybe(() => sdk.client.getPerpVoucherEligibility(BANK, account)),
      maybe(() => sdk.client.getPerpVoucher(BANK, account)),
    ]);
    const summary = (value: unknown) => value && typeof value === 'object' && 'error' in value ? value : value;
    return { account, isContract: !!code && code !== '0x', stt: formatUnits(gas, 18),
      walletUsdso: formatUnits(usd, 18), safeOwners: summary(safeOwners),
      threshold: typeof threshold === 'bigint' ? threshold.toString() : threshold,
      metaMaskIsOwner: eoaIsOwner, margin: 'error' in margin ? margin : {
        unlocked: formatUnits(margin.unlockedCollateralBalance, 18),
        withdrawable: formatUnits(margin.withdrawable, 18) },
      eligibility: 'error' in eligibility ? eligibility : eligibility.eligible ?
        { eligible: true, grantUsdso: formatUnits(eligibility.grantAmount, 18) } : eligibility,
      voucher: voucher && !('error' in voucher) ? {
        claimed: voucher.claimed, floorUsdso: formatUnits(voucher.floor, 18),
        expiresAt: voucher.expiresAt.toString() } : voucher };
  }));
  const placeSelector = toFunctionSelector('placeOrderFor(address,bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96)');
  const operatorAuthorized = await maybe(() => sdk.client.isOperatorAuthorized({
    pool: BTC, owner: accounts[1]!, operator: accounts[0]!, selector: placeSelector }));
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), chainId, block: block.toString(),
    externalEoaAuthorizedToPlaceForEmbeddedBtc: operatorAuthorized,
    campaign: campaign && !('error' in campaign) ? {
      distributor: campaign.distributor, grantUsdso: formatUnits(campaign.grantAmount, 18),
      claimsRemaining: campaign.claimsRemaining.toString(),
      startsAt: campaign.startsAt.toString(), endsAt: campaign.endsAt.toString(),
      expiryDurationSec: campaign.expiryDurationSec.toString(),
      leverageCapX: campaign.leverageCapX } : campaign, accounts: output }, null, 2));
} finally { clearTimeout(timer); controller.abort(); }

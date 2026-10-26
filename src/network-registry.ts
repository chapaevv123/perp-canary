import { BridgeToken, getBridgeToken, hidekiTestnet, somniaMainnet, somniaShannon } from '@somnia-chain/markets-sdk/chains';

export const VERIFIED_AT = '2026-10-26';
export const SOURCES = {
  somnia: 'https://docs.somnia.network/developer/network-info',
  sdkNetworks: 'https://prd.smk.somnia.host/docs/typescript/reference/networks-and-endpoints',
  hidekiPerps: 'https://app.testnet.dreamdex.io/docs/developers/perps-testnet',
  bridge: 'https://prd.smk.somnia.host/docs/typescript/bridge',
  perps: 'https://app.testnet.dreamdex.io/docs/trading/perps-testnet',
  arena: 'https://app.testnet.dreamdex.io/competition',
  paper: 'https://app.testnet.dreamdex.io/docs/trading/perps-testnet/margin-and-liquidations',
  faucet: 'https://testnet.somnia.network/',
} as const;

export type NetworkId = 5031 | 50312 | 50383;
export type NetworkConfig = {
  name: string; chainId: NetworkId; rpc: string; environment: 'mainnet' | 'testnet';
  supportedCapabilities: readonly string[];
  tokenMetadata: readonly { symbol: string; kind: 'NATIVE' | 'ERC20'; decimals: number; address: string | null; provenance: string }[];
  verifiedContractAddresses: Readonly<Record<string, string>>;
  provenance: readonly string[]; verificationTimestamp: string;
};

const shannonUsdso = getBridgeToken(BridgeToken.USDso, 50312);
const hidekiUsdso = getBridgeToken(BridgeToken.USDso, 50383);
const shannonStt = getBridgeToken(BridgeToken.STT, 50312);
const hidekiStt = getBridgeToken(BridgeToken.STT, 50383);
if (!shannonUsdso?.address || !hidekiUsdso?.address || !shannonStt?.router || !hidekiStt?.router)
  throw new Error('Installed SDK has no verified dev/test bridge addresses');

export const NETWORK_REGISTRY: readonly NetworkConfig[] = [
  { name: 'Hideki Perps', chainId: 50383, rpc: hidekiTestnet.rpcUrls.default.http[0]!, environment: 'testnet',
    supportedCapabilities: ['NATIVE_BALANCE', 'USDSO_BALANCE', 'PERP_MARGIN', 'PERP_POSITION', 'PERP_MARKETS', 'BRIDGE_ROUTE'],
    tokenMetadata: [
      { symbol: 'STT', kind: 'NATIVE', decimals: 18, address: null, provenance: SOURCES.sdkNetworks },
      { symbol: 'USDso', kind: 'ERC20', decimals: 18, address: hidekiUsdso.address, provenance: SOURCES.hidekiPerps },
    ],
    verifiedContractAddresses: { marginBank: '0x478769E1177C0773c43a593dccc4ad15f15f1394',
      usdso: hidekiUsdso.address, bridgeRouterStt: hidekiStt.router },
    provenance: [SOURCES.hidekiPerps, SOURCES.sdkNetworks, SOURCES.bridge], verificationTimestamp: VERIFIED_AT },
  { name: 'Shannon Testnet', chainId: 50312, rpc: somniaShannon.rpcUrls.default.http[0]!, environment: 'testnet',
    supportedCapabilities: ['NATIVE_BALANCE', 'USDSO_BALANCE', 'FAUCET', 'BRIDGE_ROUTE'],
    tokenMetadata: [
      { symbol: 'STT', kind: 'NATIVE', decimals: 18, address: null, provenance: SOURCES.somnia },
      { symbol: 'USDso', kind: 'ERC20', decimals: 18, address: shannonUsdso.address, provenance: SOURCES.bridge },
    ],
    verifiedContractAddresses: { usdso: shannonUsdso.address, bridgeRouterStt: shannonStt.router },
    provenance: [SOURCES.somnia, SOURCES.sdkNetworks, SOURCES.bridge], verificationTimestamp: VERIFIED_AT },
  { name: 'Somnia Mainnet', chainId: 5031, rpc: somniaMainnet.rpcUrls.default.http[0]!, environment: 'mainnet',
    supportedCapabilities: ['NATIVE_BALANCE'],
    tokenMetadata: [{ symbol: 'SOMI', kind: 'NATIVE', decimals: 18, address: null, provenance: SOURCES.somnia }],
    verifiedContractAddresses: {}, provenance: [SOURCES.somnia, SOURCES.sdkNetworks, SOURCES.perps],
    verificationTimestamp: VERIFIED_AT },
];

export function networkById(chainId: number): NetworkConfig | null {
  return NETWORK_REGISTRY.find(network => network.chainId === chainId) ?? null;
}

import { readFile } from 'node:fs/promises';
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';

const expected = {
  version: '0.32.1',
  chainId: 50383,
  rpc: 'https://api.hideki2.infra.testnet.somnia.network',
  wss: 'wss://api.hideki2.infra.testnet.somnia.network/ws',
};

const packagePath = new URL('../node_modules/@somnia-chain/markets-sdk/package.json', import.meta.url);
const installedPackage = JSON.parse(await readFile(packagePath, 'utf8'));
const rpc = hidekiTestnet.rpcUrls.default.http[0];
const wss = hidekiTestnet.rpcUrls.default.webSocket?.[0];
const client = new SomniaMarkets({
  chain: hidekiTestnet,
  indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql',
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
});
const methodNames = [
  'listPerpMarkets',
  'getPerpSystemConfig',
  'listPerpPoolStatuses',
  'getPerpFeedStatus',
];
const methods = Object.fromEntries(methodNames.map(name => [name, typeof client.client[name]]));
const result = {
  sdkVersion: installedPackage.version,
  chainId: hidekiTestnet.id,
  rpc,
  wss,
  methods,
};
console.log(JSON.stringify(result, null, 2));

if (result.sdkVersion !== expected.version || result.chainId !== expected.chainId ||
    result.rpc !== expected.rpc || result.wss !== expected.wss ||
    methodNames.some(name => methods[name] !== 'function')) {
  throw new Error('Installed SDK exports or Hideki configuration differ from the verified M0 target');
}

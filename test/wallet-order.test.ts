import assert from 'node:assert/strict';
import test from 'node:test';
import { SomniaMarkets, perpPoolWriteAbi } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createWalletClient, decodeFunctionData, http } from 'viem';

test('SDK builds a Hideki unsigned perp order without signing or sending', async () => {
  const account = '0x1111111111111111111111111111111111111111';
  const pool = '0x2222222222222222222222222222222222222222';
  const sdk = new SomniaMarkets({ chain: hidekiTestnet,
    wsRpcUrl: 'wss://api.hideki2.infra.testnet.somnia.network/ws' });
  try {
    const walletClient = createWalletClient({ account, chain: hidekiTestnet,
      transport: http('https://api.hideki2.infra.testnet.somnia.network') });
    const trader = sdk.client.createTrader({ walletClient });
    const built = await trader.buildPlacePerpOrder({ pool, isBid: true, price: 80000n, quantity: 130000n,
      orderType: 2 });
    assert.equal(built.approval, undefined);
    assert.equal(built.order.chainId, 50383);
    assert.equal(built.order.to.toLowerCase(), pool.toLowerCase());
    assert.equal(built.order.value, 0n);
    const decoded = decodeFunctionData({ abi: perpPoolWriteAbi, data: built.order.data });
    assert.equal(decoded.functionName, 'placeOrder');
    assert.equal(decoded.args[0], true);
    assert.equal(decoded.args[2], 80000n);
    assert.equal(decoded.args[3], 130000n);
    assert.equal(decoded.args[5], 2);
  } finally {
    await sdk.close();
  }
});

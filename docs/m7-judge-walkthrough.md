# Perp Canary M7 — judge walkthrough

**Product:** a wallet-confirmed, risk-explained dreamDEX perps terminal on Somnia Hideki (50383). A real delegated BTC order was placed and fully filled. The demo does not place another order automatically.

1. Open BTC-PERP. Show the trusted pinned on-chain order book, official SDK fill-derived candles, recent indexed fills and source labels. Indexer history may lag; no synthetic candles appear.
2. Connect an EIP-1193 wallet. Compare **Direct Wallet** and **Delegated Perps**: the operator pays gas while Wallet 1 owns delegated margin, positions and orders. Inspect balances, grants, position intelligence, open orders and finished order history.
3. Enter a small tick/lot-aligned PostOnly order and choose **Review wallet order**. Inspect Canary Trade Guard V2, owner, pool, calldata, margin preview, nonce, expiry, gas and simulation. Stop before wallet confirmation unless the owner explicitly authorizes a new trade.
4. Open **Verified trade**. Order `14978756187852164141712` links [placement](https://explorer.testnet.somnia.network/tx/0xb542d3a603b33a598f8dab8d2e4f38c8b7ee163bfbd169dd32acc9429d35d28f) and [fill](https://explorer.testnet.somnia.network/tx/0x1b7e19bb1afbf14ed21e74da7cf667ccb17c40ec310698293dbd6e4c343f65d4) with decoded events. The fill was BUY 0.00013 BTC at 80880 USDso. Wallet 1 already had a position; only this increment belongs to the demonstrated execution. Historic preflight was not recorded.
5. Show a price-only position scenario and unavailable states for unsupported realized PnL and liquidation price. Scenarios are not execution or liquidation forecasts.
6. Show responsive layouts and the public security runbook. The packaged server has a public route allowlist but has not been deployed.

Artifacts: [live browser terminal](screenshots/m7-terminal-live.png), [mocked wallet terminal](screenshots/m7-terminal-mocked.png), [verified replay](screenshots/m7-replay-verified.png), [evidence bundle](evidence/verified-delegated-btc-order.json), [acceptance ledger](m7-product-acceptance.md).

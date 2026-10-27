# M6.2 — exact delegated BTC order investigation

Read-only on-chain verification on Somnia Hideki **50383**, 2026-10-27. Reproduce with `node --experimental-strip-types scripts/m62-order-forensics.ts`. The script does not sign or send.

## Placement

- Order ID: `14978756187852164141712`; BTC-PERP pool `0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0`.
- Transaction `0xb542d3a603b33a598f8dab8d2e4f38c8b7ee163bfbd169dd32acc9429d35d28f`, successful receipt in block **34789238**.
- Sender/operator `0x6Fa3659a15e9264E43EC67Fe4bB5d31D38109A42`, `placeOrderFor` selector `0x80054449`, calldata owner `0xE350c75b3B152CC5481FFE13c8078Ab35c90b20f`, BUY PostOnly `0.00013 BTC` at `80880 USDso`.
- Matching pool `OrderPlaced` (log 79) identifies Wallet 1 as owner and the exact order ID; `OrderRested` (log 80) proves it initially rested. The UI's earlier `RESTING` state was accurate at that read.

## Full fill and current state

- A separate successful transaction `0x1b7e19bb1afbf14ed21e74da7cf667ccb17c40ec310698293dbd6e4c343f65d4` in block **34790084** emitted the matching pool `OrderFilled` (log 162). This order is the **makerOrderId**. `quantityFilled = 0.00013 BTC`, `makerRemainingQuantity = 0`, `fillPrice = 80880 USDso`. Its own receipt includes the matching event.
- Live SDK on-chain open orders at block **34794152**: **none** for Wallet 1 on BTC-PERP. Wallet 1 position: **0.05429 BTC**, entry **80045.802320869405046969 USDso**. Before this order, a prior live read had **0.05416 BTC**; the increase is exactly **0.00013 BTC**, matching the fill event. The order added to the long position.
- Official SDK indexer independently lists the exact ID as `Filled`, original and filled quantity both `0.00013 BTC`, `rested: true`. This corroborates the on-chain event; the event and current open-order read establish the lifecycle.

**Conclusion: FULLY FILLED; NOT CANCELLABLE.** It was not cancelled or expired. The `Review cancel` button came from an earlier open-order snapshot. The server's fresh account read correctly refused to prepare `cancelOrderFor` after the fill. No cancellation transaction was signed or sent.

## UI and preflight changes

The server now returns `ORDER_NOT_OPEN` with the fresh read block, owner, market and ID. The UI displays the reason, refreshes Wallet 1 open orders, clears the stale selected ID and loads indexed history. Future delegated cancel confirmations require a new open-order read, active cancel grant, unchanged owner/operator/ID/pool/calldata/nonce, successful fresh simulation and the 0.1 STT gas cap. A changing gas estimate may be accepted only after those checks. Unit and Chromium regression tests cover an open-to-closed transition and prevent a wallet request from a stale row.

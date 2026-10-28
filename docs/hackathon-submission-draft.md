# Perp Canary — dreamDEX Perps Builder Bounty submission draft

**Project:** Perp Canary, an execution-intelligence and risk-management terminal for dreamDEX Perps on Somnia Hideki Testnet (chain 50383).

**Live demo:** https://perp-canary.onrender.com/

**Source:** https://github.com/chapaevv123/perp-canary

**Problem:** A quote or a successful transaction does not prove that an order was safe to send, placed, rested, filled, or later cancelled. Perp Canary connects verified live market reads, guarded unsigned order preparation, and receipt-backed execution evidence.

**Implemented:** 21 discovered USDso perp markets; pinned SDK and direct-RPC order book; chart with indexed candles; Market Radar; browser-local, open-tab alerts; SDK account Trade Journal and verified Execution Replay; estimated position sizing with a clearly hypothetical stop reference; PostOnly BUY/SELL review for direct and delegated accounts; wallet-scoped optional custom order-notional maximum (off by default); wallet permissions, margin, gas, grid, price and simulation checks. Wallet writes require a separate explicit review and MetaMask confirmation. Only PostOnly is enabled in the browser; SDK enum values for other order types do not establish a verified wallet workflow.

**Verified execution evidence:** A delegated BTC-PERP BUY PostOnly order for Wallet 1 was placed and later filled on Hideki on 2026-10-27. The receipt, pool events, official SDK indexer, and position delta were checked independently. Evidence: [verified-delegated-btc-order.json](evidence/verified-delegated-btc-order.json). This historical trade does not prove that every current wallet path will execute.

**Safety and limitations:** Fresh market and account reads, SDK maximum placeable size, available margin, tick and lot grid, grants, nonce, gas budget, 1% mark deviation, simulation, expiry, and fresh final preflight govern order preparation. There is no default Perp Canary notional cap; an owner may enable a positive custom maximum. Alerts run while the tab is open. Stops in sizing are hypothetical; exchange-side protective stop orders are not installed. Complete PnL, guaranteed reduce-only close, and Market/IOC browser execution are not implemented. A new wallet signature or trade has not been performed during M11 acceptance. Render Free may cold start after inactivity.

**Owner submission checklist:** Open the [live demo](https://perp-canary.onrender.com/) and [source](https://github.com/chapaevv123/perp-canary); verify the latest Render deployment SHA in the dashboard; record a short walkthrough; confirm the official bounty rules and eligibility; submit the DoraHacks application manually. Do not describe mocked browser execution as a live trade.

# Judge walkthrough

1. Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:ui`, `npm run build`. Browser tests use controlled fixtures and do not sign.
2. Run `npm run serve`; visit `http://127.0.0.1:8787/`. The server needs outbound Hideki HTTPS and WebSocket for live readings. Read-only requests do not need a wallet.
3. Open Market Radar and scan. Inspect quote freshness, source, depth and score tooltip. Live acceptance captured 21/21 supported PERPs; current network conditions can differ.
4. Inspect BTC-PERP in Terminal. The chart and order book are actual read-only sources. Open Canary Guard; incomplete input shows NOT READY, valid input READY FOR REVIEW, and only a fresh preflight may show SAFE/CAUTION/BLOCKED.
5. Open Alerts and create a rule. The deterministic fixture browser test demonstrates one threshold crossing, deduplication and acknowledgement. Do not expect notifications while the browser is closed.
6. Open Trade Journal with the known operator wallet on Hideki, select Delegated Perps, and load pages. Use the verified order's Replay button to see placement and fill evidence. No wallet transaction is required to inspect public indexer data.
7. Review [acceptance](../m8-product-acceptance.md), [security](../m8-security-review.md) and the immutable [evidence bundle](../evidence/verified-delegated-btc-order.json). The [public Render Free demo](https://perp-canary.onrender.com/) is available for read-only inspection and can cold start after inactivity. A reported MetaMask phishing warning remains under official review; do not connect or sign on a flagged URL.

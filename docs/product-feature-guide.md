# Trader guide

1. **Discover:** Open Market Radar, scan the verified PERP registry, sort by score/spread/depth or filter favorites. The score measures the quality of current market data and visible liquidity, not expected return. Unavailable 24h metrics remain labeled.
2. **Analyze:** Inspect a market to open the terminal's live chart, trusted book and Position Intelligence. Indexed candles and order history can lag the live chain.
3. **Plan:** Open Position Sizing, enter risk capital, percentage or an absolute risk budget, limit entry and hypothetical invalidation reference. The result is an estimate, not a protective stop. Use calculated quantity explicitly.
4. **Verify:** Canary Guard distinguishes input readiness from a fresh SAFE/CAUTION/BLOCKED decision. PostOnly shortcuts offer best bid for BUY and best ask for SELL only with a fresh trusted book.
5. **Execute:** Review the exact owner/operator, pool, margin, gas and simulation. A separate explicit wallet action requests one transaction. No M8 feature places a trade automatically.
6. **Monitor:** Create market alerts for trusted price/spread/funding thresholds and feed health. Monitoring works only while this browser tab is open; alerts and acknowledgements are local to this browser profile and connected address.
7. **Learn:** Trade Journal loads official SDK finished-order pages for the connected address, deduplicates by order ID and exports displayed records. Open the verified historical Canary order in Execution Replay. An indexed order is not proof of realized PnL; fees and win/loss are unavailable without full reconciliation.

Source and operational limits: Radar's 21-market scan is manual, with two concurrent reads and per-request browser deadlines. Enabled alerts check only their markets once per minute while the page is visible. The SDK order indexer returns 20 history rows per page; the API caps offset at 1,000. A page or network outage gives an explicit unavailable state. No data is invented to fill gaps.

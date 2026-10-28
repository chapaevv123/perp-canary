# M7.4 UX acceptance — 2026-10-28

Baseline: M7.3 `1f2cc67fcee7289dec39e6ee7410bd9629903d70`. The interrupted edits in `web/market-chart.js`, `web/terminal.css`, `web/terminal.js`, and `web/trading.js` were preserved and completed in place. `design/` remains untracked and untouched.

| Area | Acceptance | Evidence / limit |
| --- | --- | --- |
| Typography and responsive layout | PASS | Body 16px; secondary text 12–13px; buttons 14–15px; Chromium layout checks at 320–2560px without page overflow. Position table scrolls within its panel on narrow screens. |
| Trading account context | PASS | Wallet 1, Delegated Perps, selected market and permission appear in compact strip. Addresses, grant, SDK and block evidence are under Wallet & permissions. Missing grant/gas and wrong chain remain visible warnings. |
| PostOnly shortcuts | PASS | BUY uses fresh trusted best bid; SELL uses fresh trusted best ask. Crossing opposite-side button is disabled with explanation. Exact grid, book freshness and crossing validation remain in preview and server preflight. Chromium tests switch BUY/SELL and BTC/ETH. |
| Canary Guard | PASS | NOT READY for missing input; READY FOR REVIEW for valid preview before checks; CHECKING during preparation; SAFE/CAUTION/BLOCKED from deterministic Guard report; UNAVAILABLE when fresh checks cannot complete. READY FOR REVIEW never enables wallet submission. Confirm performs fresh mandatory preflight before wallet request. |
| Positions | PASS | Compact market, side, size, entry, mark, unrealized PnL, funding, free margin and liquidation reference. Missing SDK metrics say Unavailable. Position Intelligence and scenario remain expandable. Wallet 1 current position is distinct from historical execution; only 0.00013 BTC is attributed to the verified order. No close control added. |
| Chart | PASS with source limit | Real fill-derived OHLCV supports interval selection, zoom, pan, crosshair, OHLC readout, latest visible close line, reset and resize. When indexer has no candles, only observed live mark trace appears; no candles are synthesized. Browser interaction test uses clearly mocked candle data. |
| Book | PASS | Tabular numeric alignment, bid/ask color, spread, source, timestamp and block. Depth bars render only for VERIFIED levels. Stale/untrusted book disables price shortcuts. |
| Navigation | PASS | Chromium exercises market dialog, favorites, recents, account tabs, wallet details, history, Execution Replay, refresh and source diagnostics. Legacy/localhost navigation regression remains tested. |

The screenshots in `docs/screenshots/m74-*.png` are **Chromium with mocked market/account responses**. They demonstrate layout and interactions, not current chain state or live trading eligibility.

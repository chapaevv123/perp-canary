# M7 product acceptance — recovery ledger

Updated 2026-10-28. Baseline: `d342446` (M6.3). The interrupted M7 worktree and pre-existing untracked `design/` reference were preserved. No wallet signature, chain write, push, deployment or submission was made during recovery.

| Area | Status | Evidence / limit |
| --- | --- | --- |
| Responsive trading terminal | DONE locally | Chromium at 390, 1440, 1920 and 2560 px; market, book, trade form, balances, position, open orders and history. |
| Real chart and market tape | DONE | Official SDK fill-derived OHLCV and indexed fills; live BTC 5m read returned 120 candles and 20 recent fills. Honest unavailable state; indexer may lag. |
| Canary Trade Guard V2 | DONE for supported path | Eight explained check groups; fresh server gates and a second pre-wallet review; safe-to-review, caution and blocked states. |
| Position Intelligence | DONE for SDK metrics | Pinned size, entry, mark, unrealized PnL, funding and margin; exact price-only scenario. Unsupported realized PnL/liquidation stay unavailable. |
| Execution Replay | DONE for verified order | Placement/fill receipts, decoded events, indexer status and exact 0.00013 BTC increment. Historic preflight explicitly unavailable. |
| Public HTTPS mode | PREPARED | Route allowlist, Host/Origin, rate limits, headers, Caddy/runbook, package. Real domain/VPS smoke pending. |
| Guaranteed delegated reduce-only | BLOCKED | No verified owner-scoped protocol path; no claim in UI. |
| DoraHacks submission | OWNER ACTION | Requires whitelist, public links and approval. Portal detail page returned 405; organizer Eventbrite ends Nov 2, secondary summaries say Nov 1. Treat Nov 1 as conservative. |

## Recovery checkpoint

- [x] Inspected Git status/log/diff/check after M6.3 without reset or clean.
- [x] Recovered M7 source, tests, deployment files and screenshots.
- [x] Fixed header typecheck assertion, browser fixture 400 errors and outdated chart title assertion.
- [x] Removed public links to owner-only diagnostics; corrected release manifest note.
- [x] `npm.cmd test`: 176 passed, 0 failed.
- [x] `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run build`: passed.
- [x] Chromium `CANARY_UI_LIVE=1 npm.cmd run test:ui`: 12 passed, 0 failed, 0 skipped.
- [x] Live reads: 120 BTC candles; 20 indexed fills; Wallet 1 pinned position at block 35178231, LONG 0.05429 BTC.
- [x] Screenshots: [live](screenshots/m7-terminal-live.png), [mocked](screenshots/m7-terminal-mocked.png), [replay](screenshots/m7-replay-verified.png).
- [ ] Approved-domain HTTPS deployment and public smoke.
- [ ] Owner-approved Git push, whitelist confirmation and DoraHacks submission.

## Safe resume point

Run `git status --short` before changing files and preserve `design/`. Use [final report](m7-final-product-report.md), [deployment runbook](m7-deployment.md) and [judge walkthrough](m7-judge-walkthrough.md). Do not create a transaction or deploy without explicit approval.

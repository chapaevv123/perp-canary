# M5.1 continuation report (2026-10-27)

This document records the interrupted M5.1 work recovered from the uncommitted tree and the continuation completed locally. It is a development report, not a claim of a production-ready trading product. No user-wallet transaction was signed or sent in this session.

## Phase status

| Phase | State | Evidence and limit |
| --- | --- | --- |
| Market discovery | Implemented, read-only verified | Official SDK and factory returned 21 tradeable USDso perp markets; selected-market bank, tick, lot, minimum and pinned book are checked against pool/RPC. Liquidity and each wallet's ability to trade vary. |
| Live terminal | Implemented, read-only verified | Live Chromium smoke displayed a TRUSTED BTC book and distinct chart quotes. The first market snapshot took 6.46 seconds in a local measurement. |
| User-wallet order preparation | Implemented, transaction unverified | BUY/SELL PostOnly runs account, margin, book, grid, notional, gas and contract simulation checks. Only explicit wallet confirmation calls `eth_sendTransaction`. Mocked Chromium confirms UI control flow. |
| Margin and order actions | Implemented, transaction unverified | Exact USDso approve, deposit, withdraw and open-order cancel have separate fresh reviews, simulation and wallet confirmation. No real user-wallet receipt validates these writes. |
| Guard, Radar, sizing, alerts | Implemented with stated limits | Guard fails closed; Radar uses fresh visible depth; sizing uses integer units, side-specific stop reference and the 100 USDso Guard cap. Alerts operate only while the tab is open. |
| Trade Review and journal | Partial | Receipt and current open-order observations are kept distinct. The journal stores public hashes in local browser storage. It is not a complete cross-device trade, fill or PnL ledger. |
| AI Copilot | Not implemented | UI states that no model service is connected. Deterministic checks are not presented as AI. |
| Public online deployment | Not started | Loopback-only service; no push, publication or competition submission. |

## Live evidence and performance

The read-only SDK probe on 2026-10-27 returned these factory-tradeable markets: 1000PEPE, ADA, AVAX, BNB, BTC, DOGE, ETH, HYPE, LINK, LIT, NEAR, PUMP, SOL, SUI, TAO, VVV, WLD, XLM, XRP, ZEC, ZRO. The list is dynamic and can change. The live Chromium smoke passed with a trusted BTC book and the verified historical owner-order state. A direct local request returned the separate owner-account position and orders in 4.98 seconds. The full indexed history scan completed in 38.88 seconds after four bounded concurrent range reads; the position panel no longer waits for it.

`npm.cmd test`: 151/151 pass. `npm.cmd run test:ui`: 8/8 mocked browser checks pass; a separate live RPC browser smoke passed (9/9 with live enabled). `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run verify` and `git diff --check` pass. Browser mocks verify controls and blocked states, **not** a real trade. The M4 owner-bot proof remains the sole verified execution result: transaction `0x45cca8d50aead7a4734849759cd1f5699112fea0feb938f6bdd0e8ae2cc0f121`, block 34465778, `OrderPlaced` and `OrderRested`. Its later absence from open orders has unknown cause.

## Owner checkpoint

The next proof requires a funded user EIP-1193 wallet on Hideki 50383, a fresh guarded small PostOnly review, and an explicit owner decision followed by wallet confirmation. Mark the reviewed transaction **READY_FOR_OWNER_CONFIRMATION** before sending. Independently verify the receipt, event owner, pool, order ID and subsequent open/fill state. Deposit and cancellation need their own confirmations and evidence. Until then, do not describe M5.1 as an independently verified trading lifecycle.

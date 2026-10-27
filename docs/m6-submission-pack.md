# Perp Canary — DoraHacks submission packet

Prepared 2026-10-27. **Draft only; no repository push, public deployment or submission has occurred.**

## Event and eligibility

The repository identifies the **dreamDEX Perps Builder Bounty** on [DoraHacks](https://dorahacks.io/hackathon/dreamdex-perps-bounty/detail). The [organizer's Eventbrite listing](https://www.eventbrite.com/e/dreamdex-perps-builder-bounty-tickets-2003605109819) shows an event span ending around **2 November 2026** and says only whitelisted DoraHacks email addresses may submit Builds. It directs non-whitelisted builders to the dreamDEX Discord or SomniaHacks Telegram. The DoraHacks detail page returned HTTP 405 to automated read-only checks; exact submission cutoff, category criteria, team rules, deliverable fields and account eligibility **remain unverified**. The owner must inspect the logged-in portal before claiming eligibility or submitting. The Perps Arena trading contest is a separate event.

## English submission copy

**Elevator pitch:** Perp Canary is a guarded dreamDEX Perps terminal that makes the account behind each trade explicit and checks a live order twice before asking MetaMask to sign.

**Problem and solution:** A connected EOA and a delegated dreamDEX smart account can have different balances, positions and permissions. Perp Canary shows Direct Wallet and Delegated Perps separately. It discovers official SDK markets, verifies a pinned order book against direct RPC, reads the selected account's margin and pool grants, and prepares a PostOnly order only after Trade Guard checks price grid, quantity, notional, mark deviation, margin, gas, nonce, expiry, calldata and contract simulation. A second preflight runs immediately before the wallet prompt. The server prepares unsigned calls and does not broadcast user trades.

**Technical architecture:** Node.js 22 TypeScript server; `@somnia-chain/markets-sdk@0.32.1`; viem contract reads and simulation; browser EIP-1193 wallet; Somnia Hideki chain 50383. The operator pays STT gas for `placeOrderFor`, while Wallet 1 owns USDso margin, positions and orders. Receipt and matching pool logs establish placement; a later `OrderFilled` log, on-chain open-order read and SDK indexer establish the completed order lifecycle. The indexer can lag the chain.

**Verified trade:** Operator `0x6Fa3659a15e9264E43EC67Fe4bB5d31D38109A42` placed a delegated BTC-PERP BUY PostOnly order for Wallet 1 `0xE350c75b3B152CC5481FFE13c8078Ab35c90b20f`. Order `14978756187852164141712`, 0.00013 BTC at 80880 USDso, placement transaction `0xb542d3a603b33a598f8dab8d2e4f38c8b7ee163bfbd169dd32acc9429d35d28f` in block 34789238, full fill transaction `0x1b7e19bb1afbf14ed21e74da7cf667ccb17c40ec310698293dbd6e4c343f65d4` in block 34790084. Both receipts succeeded. Matching `OrderPlaced`, `OrderRested` and `OrderFilled` events were decoded. The pre-existing Wallet 1 BTC position grew from 0.05416 to 0.05429 BTC, matching the 0.00013 BTC fill; the entire position is **not** attributed to Perp Canary. Reproduce the read-only checks with `node --experimental-strip-types scripts/m62-order-forensics.ts`; [timestamped JSON evidence](evidence/verified-delegated-btc-order.json).

**Features:** Live SDK market discovery, pinned book, observed mark trace, clear account mode, separate gas and margin, guarded BUY/SELL PostOnly review, fresh order and cancellation preflight, on-chain receipt state, open orders, official SDK finished-order history, transparent sizing reference, in-tab market radar and local transaction journal.

**Limits:** One delegated placement and fill is verified. A cancellation, direct EOA trade and position close are not live-verified. The installed delegated `placeOrderFor` ABI has no position reduce-only flag; `reduceOrderFor` reduces an open order, not a position. No guaranteed delegated reduce-only close control, market/IOC, complete PnL, model-backed AI advice, background alerts or public production deployment is claimed. Exchange and funding fees are not quoted by the terminal.

**Links for owner to fill:** `[PUBLIC_DEMO_URL]`, `[PUBLIC_REPOSITORY_URL]`, `[DORAHACKS_BUILD_URL]`. Do not include unverified explorer links or claim publication before each is checked.

## Judge walkthrough

1. Open the local terminal on Hideki 50383. Show a trusted BTC-PERP book, selected pool, mark and live observation trace.
2. Connect the operator EOA. Compare Direct Wallet margin with Delegated Perps Wallet 1 margin, position and effective pool grants.
3. Use current book data to prepare a small PostOnly review. Show the exact owner/operator, price, size, risk, gas, expiry and simulation. Stop before wallet confirmation; the completed historical trade is sufficient live-write evidence.
4. Load Wallet 1 history: the exact verified order is `Filled`; the current open-order list does not contain it. Show that cancellation of a filled order is blocked with a fresh state explanation.
5. Open the [evidence JSON](evidence/verified-delegated-btc-order.json) and explain the before/after position attribution and indexer lag.

## Media and evidence

- [Live terminal](screenshots/live-terminal.png): live read-only market view at capture time.
- [Delegated review](screenshots/delegated-review-mocked.png): **MOCKED** wallet review layout; no transaction claim.
- [Mobile review](screenshots/mobile-mocked.png): **MOCKED** responsive UI.
- [Verified JSON](evidence/verified-delegated-btc-order.json): **LIVE ON-CHAIN** receipts/events plus **LIVE READ-ONLY** account/indexer; observations are timestamped and can change.
- [M6.2 investigation](m62-order-cancellation-investigation.md): explains why the resting order later became uncancellable after full fill.

## Owner submission checklist

1. Confirm DoraHacks email whitelist, exact deadline, category, team eligibility, fields and required public assets in the logged-in official portal.
2. Review the release limitations and screenshots; replace the three link placeholders only with verified public links.
3. Approve and perform public deployment and repository publication separately. The current server is loopback-only; see [release readiness](m63-release-readiness.md).
4. Submit the Build manually after reviewing the final text. No automated submission is part of this project.

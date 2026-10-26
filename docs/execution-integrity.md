# Execution Integrity M1

This documents the M1 read-only planner and receipt verifier. M2 adds a separately confirmed browser-wallet PLACE path, described in [M2 wallet flow](m2-wallet.md). The three M0 snapshots and their SHA-256 chain remain unchanged. New plans and reconciliations use `execution-evidence/`, a separate local hash chain excluded from Git because account addresses and transaction hashes can identify a user.

## Confirmed SDK 0.32.1 surface

| Need | Installed SDK API | M1 use |
| --- | --- | --- |
| Market and factory state | `listPerpMarkets`, `getPerpSystemConfig`, `listPerpPoolStatuses`, `getPerpFeedStatus` | Live plan preflight |
| Margin and size | `previewPerpOrderMargin`, `getMaxPerpOrderSize` | Read-only plan gate; `autoPull` omitted |
| Resting order | `getOrderOnchain(pool, orderId)` | Cancel owner and remaining-size check |
| Position | `getPerpPosition({ marginBank, account, pool })` | Before and current-after observations |
| Place/close | `trader.placePerpOrder({ pool, isBid, price, quantity })` | Method and raw parameters documented in plan; never called |
| Cancel | `trader.cancelOrder({ pool, orderId })` | Method and parameters documented in plan; never called |
| Receipt and calldata | `client.getViemClient().getTransactionReceipt/getTransaction`, SDK `perpPoolWriteAbi` | Read-only imported-hash verification; compare actual call fields |
| Events | SDK `orderBookEventsAbi`, `perpPoolEventsAbi`, `marginBankEventsAbi` with viem `decodeEventLog` | Fill, order and position event extraction |
| Local wallet | EIP-1193 `eth_requestAccounts`, `eth_chainId` | Optional browser address connection; no signing |

Official network and contract references: [dreamDEX developer guide](https://app.testnet.dreamdex.io/docs/developers/perps-testnet), [Somnia SDK perp guide](https://prd.smk.somnia.host/docs/typescript/perps). Hideki is chain `50383`; the app verifies it before planning or importing a receipt. Per-market pool and MarginBank addresses come from SDK rows, not hardcoded guesses.

## M1 read-only manual path

1. Open the local app with `npm.cmd run serve`; optionally connect a local wallet address. The browser asks only for the public address and requires chain `50383`.
2. Capture a current snapshot, choose a market and run a PLACE dry-run. Enter a limit price on the market tick grid and a quantity on its lot grid. The SDK checks tradeability, feed, current position, margin preview and placeable maximum. The plan records raw SDK parameters, blockers, warnings and a hash.
3. M2 can now build an unsigned PLACE order and offer it to a browser wallet after a fresh preflight and explicit user decision. The server has no send endpoint. A transaction is sent only if the owner confirms the wallet prompt. Paste its hash into the app if automatic receipt polling is still pending.
4. For a resting order, make a CANCEL plan with its order ID and inspect the on-chain owner and remaining quantity. A later manually approved cancellation can be reconciled by hash.
5. For an open position, make a CLOSE plan. The side is opposite the current signed position. A close limit order has **no reduce-only guarantee** in this SDK surface; recheck the position immediately before any manual signature. Import the close receipt and inspect fill and position events.

`GET /api/v1/execution` returns verified local records. `POST /api/v1/plan` and `POST /api/v1/reconcile` perform read-only network calls and append local evidence. `POST /api/v1/snapshot` captures a new M0-compatible live snapshot. `npm.cmd run verify` checks both evidence chains. API requests are limited to local origin and small JSON bodies.

## Verdict scope

`RED` means a verified receipt reverted, targeted a different pool, predates the baseline, overfilled the planned size, or filled beyond the limit. `AMBER` means a critical link is missing or ambiguous, including a fill without a matching owned order ID, a missing order/position event, an unverified linked sender, or a position delta that may have changed after the plan. `GREEN` means the **observed receipt fields** match the bounded plan. It does not mean profitable trading, execution safety in general, or contest acceptance.

The plan's RPC block, market row, feed, position and preview are sequential reads and are not one atomic state. Post-position is a current read after receipt collection, not pinned to the receipt block. Protocol trading fee and true market slippage are `NOT_MEASURED`; gas used is shown separately. A local test fixture never appears as a real trade in the UI. The M1 flow has no signed order receipt until a real owner-approved transaction is supplied.

Read-only SDK calls and local tests can proceed while the bounty whitelist request is pending. Whether a particular account can trade depends on its testnet STT, USDso or paper-credit eligibility, margin and market restrictions. Whitelist submission status is separate and remains unconfirmed here.

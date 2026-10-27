# M4.1 first-proof fast track

No transaction is signed or broadcast by `canary-price`, `canary-first-proof`, or `canary-status`. The existing `bot-execute execute` CLI is the only owner-controlled signing path. The Wallet 1 BTC-PERP LONG was opened manually and is not Canary proof.

## Read-only quote and owner-selected plan

From this repository in PowerShell:

```powershell
npm.cmd run canary-price
npm.cmd run canary-first-proof
```

`canary-price` reads BTC-PERP through the existing SDK/on-chain integrity pipeline. It shows best bid/ask, mark, tick, minimum rounded lot quantity, margin, source/block metadata and 10/25/50 bps BUY prices below the **current best bid**, rounded down to tick. A candidate must be below the ask, within 1% of mark, and within the 100 USDso notional budget. It is a suggestion, not a fill or margin guarantee. Full SDK margin preview, gas estimate, delegated permissions and simulation run only after a price is selected.

`canary-first-proof` asks the owner to select a candidate number or enter a limit manually. Empty input cancels. It makes a new independent market read, validates the exact selected limit, creates a short-lived PostOnly plan using the existing planner, and immediately invokes the existing read-only `bot-execute check`. It does not silently reprice when the market moves. If either step blocks, discard the plan and start the command again. `PostOnlyWouldCross` can still occur between the last check and inclusion; contract post-only behavior rejects a crossing placement.

On `READY_FOR_OWNER_REVIEW`, the command prints the plan hash, expiry, chosen price/quantity, notional, gas estimate/limit/budget, recheck snapshot and a ready-to-copy `bot-execute execute` command. That command is **not run automatically**. The owner must make a separate decision, review the exact hash and CLI fields, type `EXECUTE <hash>`, then enter the existing keystore password only in the local terminal. If the plan expires, start again. Never retry an uncertain broadcast automatically.

## Read-only status after an owner transaction

```powershell
npm.cmd run canary-status -- <exact-plan-hash>
npm.cmd run canary-proof -- create <exact-plan-hash>
npm.cmd run canary-verify -- <reported-bundle-path>
```

`canary-status` verifies the plan and ledger, independently reads the transaction/receipt through Canary Proof, decodes official OrderPlaced/OrderRested/OrderFilled/OrderCancelled events, and separately checks the current on-chain Wallet 1 BTC-PERP open-order list. `RESTED_AT_PLACEMENT` means only that the order rested in the placement transaction. `OPEN_AT_READ` means it appeared in the independently read open-order list at the reported block; it may change later. `NOT_OPEN_AT_READ` does not by itself identify fill, cancellation or expiry. Missing receipt, events, or current order data remain `UNKNOWN` or partially verified.

If still open and the owner wants cancellation, use dashboard Execution Control to discover the order ID and prepare a **separate** CANCEL plan. Cancellation requires its own exact-hash CLI confirmation and signature. Nothing here cancels automatically. Preserve the ledger and proof if broadcast status is uncertain; reconcile, never retry.

## Live read-only validation

At 2026-10-27 09:18:08 UTC, block 34404939, `canary-price` read a TRUSTED bid/ask of 79778.9 / 79779 USDso, mark 79619.4094142556, tick 0.1, minimum quantity 0.00013 BTC and 1000 USDso available margin. The suggested limits were 79699.1 / 79579.4 / 79380 for 10/25/50 bps. These values are historical and authorize no later operation. No plan was signed or broadcast during M4.1.

# Demo walkthrough

1. Run `npm.cmd run serve` and open `http://127.0.0.1:8787` on the same machine.
2. Show the live BTC-PERP mark, best bid/ask, spread, freshness, and block. Refresh once; the line chart adds only sampled quotes observed since page open. If RPC is unavailable, explain the `UNKNOWN` state.
3. Show the owner wallet position from the fresh SDK read, open orders, and first-order timeline. Explain `NOT_OPEN_AT_READ` and `UNKNOWN` cause.
4. Show the receipt, order ID, proof hash, transaction hash, and matching `OrderPlaced` / `OrderRested` events. Copy the hashes; optionally run `npm.cmd run canary-status -- c48415ec3cc8cba6392294529f650c4be7a925b66f5f4b03f33eb6ad9cd52ed2` for an independent read-only status.
5. Show the risk panel. `NOT_RUN` means a gate has not been exercised for a specific order. The browser trade controls do not place an order.
6. For a *separate owner-approved live demonstration*, the owner may run `npm.cmd run canary-first-proof` in their own terminal. The command prints the full plan hash and expiry. The owner decides whether to run the separate execution command and exact confirmation. Do not submit an order for a recorded or automated demo without explicit owner action.

The first order is already proven. A bounty demo can be entirely read-only; no new transaction is required to demonstrate the product.

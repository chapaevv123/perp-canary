# M6.1 delegated confirmation preflight fix

## Reproduced root cause

The `confirm-wallet` handler in `web/trading.js` used `tx.gas !== oldTx.gas` as a reason to reject a fresh order. This was an exact comparison of a dynamic `eth_estimateGas` result. A 2026-10-27 live read-only two-pass probe reproduced the user-facing failure without a wallet signature: both passes were `READY`, owner/operator, calldata, pool, nonce and expiry matched, and the new BTC book still allowed the same PostOnly limit. The market block advanced from **34780993** to **34781092**, while the prepared gas limit changed from **0x2681df** to **0x2641a7**. The old browser code would reject that valid fresh plan solely because of the gas difference. The fixed probe used a newly observed tick-aligned limit of 80803.7 USDso for 0.00013 BTC; that plan has expired and is not reusable.

A second live probe at 19:48 UTC reproduced the mismatch in the other direction: blocks **34783036 → 34783124**, gas limits **0x29d7fc → 0x2b40dd**, with both stages `READY`, unchanged calldata/nonce/expiry, active Wallet 1 grant and 999.480175176630660395 USDso owner free margin. Its 80802 USDso limit was a transient probe value and must not be reused.

At 19:49 UTC, the fixed browser comparator evaluated another fresh read-only pair as `ok: true` with **no material issues**. Blocks advanced **34783657 → 34783767**, gas changed **0x268fa8 → 0x282bc5**, while calldata, target, operator, nonce and expiry remained identical. The fresh simulation was `PASSED`, the place grant was active, and the fresh maximum gas cost was **0.01579587 STT**, below the 0.1 STT hard cap. The 80758 USDso probe price has expired and is not an owner instruction.

## Fixed comparison

`web/preflight-compare.js` checks user intent and transaction identity separately from new observations. Mode, account, delegated owner, market, side, order type, price, quantity, chain, operator, pool, calldata, value, nonce and expiry remain binding. A new book block and a changed gas estimate are recorded as nonmaterial **only when** the complete fresh API preparation returns `READY`, the book remains trusted and noncrossing, the effective pool grant is active, owner margin is sufficient, and the new contract simulation and 0.1 STT hard gas cap pass. The wallet receives the fresh simulated gas limit. A stale review, revoked grant, moving book that crosses the limit, changed nonce or altered calldata still blocks before `eth_sendTransaction`.

The browser now shows field-level failure reasons and the available fresh bid/ask, selected limit, owner free margin, grant, simulation and gas state. If the server read fails before it can return those observations, the UI labels them `UNKNOWN`. Each failure requires a new review. No user transaction was sent by this fix or probe.

## Owner retry

Restart the local server to load the new browser module. On Hideki 50383 connect the operator EOA, choose **Delegated Perps**, confirm Wallet 1 and the BTC `place` grant, enter 0.00013 BTC and a **new** tick-aligned BUY PostOnly limit below the current bid. Review the exact owner, operator, pool, margin, expiry and gas cap. Click **Confirm in wallet** only if choosing to execute this testnet order. If the new book crosses the limit or another material field changes, read the specific diagnostic and prepare a new review. Save the resulting hash and independently check the receipt, matching Wallet 1 `OrderPlaced` event and current open state. Only a still-open order can be separately reviewed and cancelled.

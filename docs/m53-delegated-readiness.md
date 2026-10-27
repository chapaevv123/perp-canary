# M5.3 delegated Perps readiness — 2026-10-27

## Verified identities and authority

- Connected operator EOA: `0x6Fa3659a15e9264E43EC67Fe4bB5d31D38109A42`.
- dreamDEX Wallet 1 smart account / trading owner: `0xE350c75b3B152CC5481FFE13c8078Ab35c90b20f`.
- Hideki chain ID: `50383`. BTC-PERP pool: `0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0`.
- At block **34723906**, the pool reported the official permissions registry `0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a`. For this exact owner/operator/BTC pool, `isOperatorAuthorized` and the per-pool registry entries were **true** for `placeOrderFor` (`0x80054449`), `cancelOrderFor` (`0xe37b444b`) and `reduceOrderFor` (`0x364c2587`). Global entries were false. The grants are boolean entries with no observed expiry field; they can be revoked, so every preparation re-reads the effective pool grant. No authorization for another pool is inferred.
- `getOwners()` still identifies a different Safe owner. MetaMask signs as the **operator**, pays its own gas and is `msg.sender` on delegated calls. Wallet 1 remains the order/position/MarginBank owner. The grant does not allow withdrawal. [Official Link a Bot](https://app.testnet.dreamdex.io/docs/trading/common/link-a-bot), [developer perps guide](https://app.testnet.dreamdex.io/docs/developers/perps-testnet).

At block **34723371**, the operator had **5 STT**, 0 wallet USDso and 0 EOA free margin. Wallet 1 had **999.480175176630660395 unlocked MarginBank USDso**, 0 withdrawable USDso, a BTC position of **0.05416 BTC** and no open BTC orders at block **34725110**. The operator does not borrow this margin in Direct Wallet mode. The official SDK indexer returned one *indexed* finished BTC order, status `Filled` (ID `21767158006977278871793`), but that row alone is not a new user-wallet receipt or a complete execution lifecycle.

## Unsigned BTC PostOnly dry run

Run `node --experimental-strip-types scripts/m53-delegated-readiness.ts` with read-only Hideki RPC/WSS access. At 2026-10-27 18:12 UTC, pinned book block **34725170** had `TRUSTED` bid **80638.9** and ask **80649.4**. A BUY **0.00013 BTC** @ **80638.9 USDso** passed the exact tick 0.1, lot 0.00001, minimum 0.00013, 1% mark deviation, 100 USDso notional cap, voucher market allowlist, operator grant, owner MarginBank preview, SDK maximum size and `eth_estimateGas` simulation. The notional was **10.483057 USDso**, estimated gas **2,138,597 units**, reviewed limit **2,565,292 units**, and maximum cost at the observed gas price **0.015397896 STT**. The unsigned call targeted the BTC pool with selector `0x80054449`, owner Wallet 1, signer MetaMask EOA, nonce 0 and a five-minute expiry. The plan has expired; these exact price, nonce, gas and calldata values **must not be reused**.

Status: **DELEGATED_PERPS_READ_ONLY_READY; FIRST_USER_CONFIRMATION_PENDING**. `eth_estimateGas` is a simulation, not a mined transaction. No M5.3 wallet signature, claim, order or cancel was submitted. A fresh browser Trade Guard review is required before every wallet prompt.

### Continuation recheck, 2026-10-27 19:31 UTC

A new live read at account block **34772677** still showed 5 STT for the operator, **999.480175176630660395 USDso** unlocked for Wallet 1, a 0.05416 BTC Wallet 1 position, no open BTC orders, and effective BTC place/cancel/reduce flags. The first dry run at the exact observed bid was correctly blocked because the book moved and that PostOnly price crossed the newly observed ask. A second run used a tick-aligned price 0.1% below the observed bid. It passed a fresh `TRUSTED` book, owner margin preview and unsigned `placeOrderFor` gas simulation: BUY 0.00013 BTC at **80635.3 USDso**, 10.482589 USDso notional, 0.538184272225961855 USDso lock, 2,138,191 estimated gas units, and 0.015394974 STT maximum at the observed gas price. The owner was Wallet 1, sender was the EOA and target was the BTC pool. This plan expired at 19:36:23 UTC and must never be reused. A new owner wallet signature and independent receipt are still absent.

A separate live direct EOA read returned **0** EOA free margin, **0** BTC position and **0** open BTC orders. The official SDK indexer returned one Wallet 1 finished-order row, ID `21767158006977278871793`, status `Filled`, quantity 0.05416 BTC, placed transaction `0xe164fc656bd996ce7be711a4753bb40f6088f18e8abe7dc60b530fa68d4a79cc`. This is indexed historical data; its row is not evidence of a new Perp Canary MetaMask trade.

## Product path and remaining limits

Choose **Delegated Perps**, connect the MetaMask EOA on Hideki, confirm the live `place` and `cancel` pool grants and Wallet 1 margin, select a supported market with a fresh trusted book, enter a small PostOnly order, and review exact owner, operator, pool, calldata, nonce, expiry, margin preview and gas. `Confirm in wallet` is the only path to `eth_sendTransaction`. After a receipt, the UI distinguishes placement from current open state and fill. A live open order can be selected for a separately reviewed `cancelOrderFor` transaction. Direct EOA mode remains separate and still needs its own margin or paper-credit claim.

The current browser does not offer a guaranteed reduce-only **position close**, market/IOC order, a hosted public endpoint or persistent external alert service. Indexer order history may lag; the journal is local browser storage. A first **user MetaMask** order and cancel remain unverified on-chain. The old owner-bot order proof is separate historical evidence.

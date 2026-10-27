# Security model

The HTTP terminal binds to `127.0.0.1`, rejects cross-site requests, and serves only public read-only data. It does not load the keystore, accept passwords, expose a private key, return a raw signed transaction, sign, or broadcast. The browser trade fields are a visual estimate; they do not call the plan or execution endpoints. The legacy research page still offers read-only plan preparation and diagnostics.

The separate local CLI is the only transaction path. An owner selects a fresh BUY PostOnly BTC-PERP price, gets a saved hash-bound plan, reviews it, runs the exact execution command, types `EXECUTE <64-character hash>`, and unlocks the encrypted local bot keystore with masked input. The CLI repeats a complete preflight immediately before signing and broadcast. Expired plans fail closed; plans are not repriced or extended.

Execution retains the existing 300-second plan and contract expiry, maximum 100 USDso notional, maximum 0.1 STT gas, maximum 1% mark deviation, TRUSTED SDK + direct RPC order book, margin and maximum placeable checks, grants, nonce, gas and simulation, exact calldata, sender, chain ID 50383, idempotency, and final preflight. This M4.2 work does not alter those gates.

The terminal reports `NOT_RUN` for nonce, expiry, deviation, gas estimate and order simulation before a specific plan is built. A balance or grant observation is not a passed execution gate. Browser copy controls never authorize a trade; the CLI asks for exact owner confirmation. A saved command is shown only while its plan is unexpired, and even then the CLI can block it for changing conditions.

SELL, IOC, automatic cancellation and delegated position close are not presented as verified trading actions. `reduceOrderFor` reduces a resting order, not a perp position. Do not claim CLOSE_POSITION support without a separately validated delegated close path.

# M3.2 — Link a Bot address validation, 2026-10-27

## Local evidence

Read-only `bot status` returned public keystore metadata `0xA8ad1E44f4D74EF1fCDf479A97D54e6Bdf6fBE36`, chain 50383. No decryption, unlock, signing, or transaction was used. This address has 42 ASCII characters, passes strict `viem.isAddress`, and is already canonical EIP-55. `npm.cmd run bot -- address` prints that address without JSON fields or secret material. For address-only stdout without npm's own script banner, use `npm.cmd run --silent bot -- address`.

The address reported as pasted into dreamDEX was `0xA8ad1E44F4D74EF1fCDf479A97D54e6Bdf6F6E36`. It has 42 plain hexadecimal characters, passes `viem.isAddress(..., {strict:false})`, but fails strict `viem.isAddress` because the mixed-case checksum is wrong. Relative to the keystore address, positions 11 and 38 differ only by letter case; **position 39 is a different hex digit: `6` instead of `B`**. EIP-55 normalization of the pasted address yields `0xA8aD1e44f4D74Ef1FcDF479A97d54E6bdF6f6E36`, a valid address for a *different account*. Re-checksumming the wrong address cannot repair that changed digit. No hidden characters occur in the address as supplied in this report; a browser clipboard value was not available for inspection.

## Official flow and remaining uncertainty

LIVE read-only Hideki check at block `34012788` found the official pool registry, but effective `placeOrderFor`, `cancelOrderFor`, and `reduceOrderFor` permissions for the correct bot address were all `BLOCKED`. This is consistent with the bot not yet being linked; it does not identify the frontend validation branch.

[Official Link a Bot documentation](https://app.testnet.dreamdex.io/docs/trading/common/link-a-bot) asks for the public address of the bot's own signing key, then lets the account owner choose Perps and grant access per market. It does not require dreamBot Builder registration or a smart-wallet address. The app performs the grant with its own signing key. The bot pays its own gas. The public frontend validator's implementation was not available in the materials inspected. Thus the exact branch that emits “That is not an address” has not been proven; a strict checksum validator is consistent with the observed rejection, while the changed hex digit independently proves the pasted value was not this bot's address.

Next, copy the output of `npm.cmd run --silent bot -- address` directly and compare the last six characters `6fBE36` before interacting with dreamDEX. Do not use the EIP-55 normalization of the old pasted value ending `6f6E36`. If the exact keystore address is still rejected, stop repeating submissions and inspect the browser DevTools input value: length, code points, and any frontend validation message or network response, without exposing cookies, tokens, keys, passwords, or request authorization headers. Capture the page URL, UTC time, browser version, exact public address, and sanitized validation response for a dreamDEX support report. A frontend defect would remain a hypothesis until that evidence is captured.

No bot was registered, no permission grant was issued, and no gas transfer was made in this audit.

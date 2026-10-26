# M2 wallet and first execution

M2 extends the existing local page. It has not submitted or reconciled an owner transaction. The server has no private key and no transaction-send endpoint.

## M2.1 RPC preflight recovery

The SDK 0.32.1 public client uses an owned WebSocket for on-chain reads. Its ordinary RPC response deadline is four seconds and it does not retry internally. The former preflight called `getBlockNumber()` through this WSS client; a successful `eth_blockNumber` call over HTTPS therefore did not establish that the WSS request would meet its deadline.

Preflight now samples Hideki chain ID and block through a 15-second HTTPS read, with one read-only retry on timeout. SDK market, account and risk reads still use the owned WSS client; a timed-out read-only preflight is retried once with a new SDK instance after cleanup. Errors expose a bounded code, phase, transport and attempt count, without raw RPC payloads or account data. A failed preflight clears the wallet-review action and creates no send-ready plan. No retry applies to `eth_sendTransaction`.

## Verified implementation

1. EIP-6963 provider discovery lists MetaMask and Rabby when installed; legacy injected providers are a fallback. Connection requests only a public account. The wallet must report Hideki chain ID `50383`. Account or chain changes invalidate the pending plan.
2. The server checks RPC chain ID, market registration/tradeability, feed, pool collateral against MarginBank, STT balance, USDso wallet balance, pinned MarginBank account state, current position, voucher eligibility, tick/lot/minimum, SDK margin preview and maximum placeable size. Whitelist status is `NOT_VERIFIED`: the installed SDK exposes trading restrictions but no proven contest-whitelist query.
3. For an unblocked PLACE plan, `client.createTrader({ walletClient })` and `trader.buildPlacePerpOrder` return unsigned calldata for a minimum-quantity IOC order. No local account or private key is used. The server checks chain, pool and zero native value, runs RPC gas simulation, rejects estimates above 10M gas and requires STT for a 10M gas limit. The wallet shows the maximum; actual gas is billed by usage. IOC avoids a resting remainder; a non-crossing IOC can revert.
4. The owner clicks **Review this order in wallet**. The browser repeats the LIVE preflight, shows the order, destination and gas budget, asks for a separate decision, checks chain again and makes one `eth_sendTransaction` request. MetaMask/Rabby shows its own confirmation. No automatic retry is made, including when the request result is unknown.
5. If the wallet returns a hash, the page imports the receipt for up to 90 seconds. The verifier checks the transaction target, decoded calldata, receipt status, owned order events, fills, position events and current position. Plan and reconciliation records enter the local SHA-256 execution evidence chain. If the receipt is pending, the hash stays visible for later manual import.

The SDK's `placePerpOrder` send verb exists but is not called by this build. Its build-only twin produces the exact order calldata; the wallet owns signing and submission. CANCEL and CLOSE remain read-only plans until their send safety and reduce-only behavior are verified. No mainnet route is available.

## Owner's first testnet trade

Run `npm.cmd run serve`, open the local page, connect MetaMask or Rabby on Hideki, choose a market and enter the minimum grid-aligned quantity at a crossing limit price. Run preflight and inspect every blocker, the market's raw units and the unsigned call. A funded wallet needs STT for gas and sufficient USDso already in MarginBank; this build does not assess wallet auto-pull or token allowance, so the wallet USDso figure is informational. Paper USDso may restrict the market. Whitelist eligibility must be confirmed separately with the organizer. Do not approve the wallet prompt until the owner has separately authorized that exact test transaction.

After a transaction, keep its hash and verify the receipt/evidence in Order Lifecycle. A GREEN verdict is bounded to fields observed by this verifier; it does not prove profit or whitelist status. Protocol fee and true slippage remain `NOT_MEASURED`; the position read can occur after the receipt block.

Official references: [dreamDEX Hideki developer guide](https://app.testnet.dreamdex.io/docs/developers/perps-testnet) and [Somnia Markets SDK perp guide](https://prd.smk.somnia.host/docs/typescript/perps).

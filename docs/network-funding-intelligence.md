# M2.4 Network & Funding Intelligence — 2026-10-26

This is a read-only extension of Perp Canary. All balances below are separate by chain and public address. The local API is `POST /api/v1/network-funding` with a JSON body containing `eoa`, `tradingAccount`, optional `pool`, and optional `reportedUiAmount`/`reportedUiSymbol`. It makes only JSON-RPC and Markets SDK reads. The response is sampled sequentially, so it is not one atomic block snapshot. Every RPC is checked with `eth_chainId` first; a mismatch stops all balance reads for that RPC.

## Official network and asset registry

Verified 2026-10-26 against [Somnia network info](https://docs.somnia.network/developer/network-info), [Markets SDK networks](https://prd.smk.somnia.host/docs/typescript/reference/networks-and-endpoints), [dreamDEX testnet perps](https://app.testnet.dreamdex.io/docs/trading/perps-testnet), [dreamDEX developer perps](https://app.testnet.dreamdex.io/docs/developers/perps-testnet), and installed `@somnia-chain/markets-sdk@0.32.1` chain definitions.

| Network | Chain ID | RPC | Native token | Verified perp deployment |
| --- | ---: | --- | --- | --- |
| Hideki testnet | 50383 | `https://api.hideki2.infra.testnet.somnia.network` | STT | Yes: MarginBank `0x478769E1177C0773c43a593dccc4ad15f15f1394`, USDso `0xed7993A74dAe1e6656B704A424DcD8711aAf4F72` |
| Shannon testnet | 50312 | `https://api.infra.testnet.somnia.network/` | STT | UNKNOWN; no verified perp deployment in the SDK registry |
| Somnia mainnet | 5031 | `https://api.infra.mainnet.somnia.network/` | SOMI | No dreamDEX perps yet, per dreamDEX testnet documentation |

USDso on Shannon is registered by the [SDK dev/test bridge](https://prd.smk.somnia.host/docs/typescript/bridge), not as a perp collateral deployment. Shannon and Hideki native STT, mainnet native SOMI, and ERC-20 USDso are different chain-specific assets. `Somnia Testnet` and `SOMI` labels in the owner-reported dreamDEX deposit UI do not establish chain ID or token identity. Global and Spot app balances have no authenticated public mapping in this integration and remain `UNKNOWN`.

## LIVE read-only findings

Observed 2026-10-26 20:50:43–20:50:56 UTC with `scripts/live-funding-smoke.ts`. All three RPCs returned the expected chain ID. Values can change; refresh before acting. `eth_getBalance`, ERC-20 `balanceOf`, SDK `getMarginAccount`, `getPerpPosition`, `getPerpVoucherEligibility`, and `getPerpVoucher` were used. BTC-PERP was the selected pool. The EOA and trading wallet were supplied by the owner; their dreamDEX account relationship is unproven.

| Chain | Address | Native | Wallet USDso | Hideki free MarginBank | BTC-PERP position |
| --- | --- | ---: | ---: | ---: | ---: |
| Shannon 50312 | EOA `0x6Fa3659a15e9264E43EC67Fe4bB5d31D38109A42` | 26.306836931197556435 STT | 0 | UNSUPPORTED | UNSUPPORTED |
| Shannon 50312 | trading `0xE350c75b3B152CC5481FFE13c8078Ab35c90b20f` | 0 STT | 0 | UNSUPPORTED | UNSUPPORTED |
| Hideki 50383 | EOA | 0 STT | 0 | 0 USDso | 0 |
| Hideki 50383 | trading | 19.312 STT | 0 | 1000 USDso | 0 |
| Mainnet 5031 | EOA | 0 SOMI | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED |
| Mainnet 5031 | trading | 0 SOMI | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED |

The Shannon EOA amount numerically matches the owner-reported `26.306836 SOMI` display to six decimals. Chain evidence identifies it as **Shannon STT**, not mainnet SOMI. The app label and selected network remain unverified. The Hideki trading wallet has a 1000 USDso voucher floor, zero locked margin, and `INELIGIBLE; alreadyClaimed` voucher eligibility. This is consistent with [dreamDEX's paper USDso rules](https://app.testnet.dreamdex.io/docs/trading/perps-testnet/margin-and-liquidations) and [Arena's 1000 paper USDso and 20 STT per wallet](https://app.testnet.dreamdex.io/competition); it is a source-backed interpretation, not proof of how this wallet was funded. Paper USDso counts as margin but is non-withdrawable and only supports designated markets. The SDK indexed portfolio observed zero open orders in the selected pool, subject to indexer lag. No deposit, bridge or trade was sent or inferred.

## Funding routes and constraints

Checked 2026-10-26. The [Somnia network page](https://docs.somnia.network/developer/network-info) lists a Shannon testnet faucet and developer support; claim availability and limits were not independently confirmed. No official public Hideki faucet was verified. The [SDK bridge](https://prd.smk.somnia.host/docs/typescript/bridge) declares a Shannon ↔ Hideki dev/test lane for STT and selected ERC-20 assets. The Hideki STT destination router held `99933247.607191715879056803` STT when read; a router balance does not prove relayer delivery, per-user bridge success, or current liquidity at a later time. The SDK bridge is explicitly a test route, with a single-validator security model. No mainnet-to-Hideki route is declared here. The [dreamDEX deposit guide](https://app.testnet.dreamdex.io/docs/welcome/making-your-first-deposit) describes an app wallet deposit flow; the owner-reported `Login wallet → Wallet 1` UI and paused USDso deposits require current app confirmation. [Perps Arena](https://app.testnet.dreamdex.io/competition) distributes paper USDso to eligible testnet wallets; this trading address already shows a voucher floor, so a new claim or deposit is not indicated by the observed state.

The trading wallet has observed gas and paper margin, but a first trade remains `UNKNOWN`, not `READY`: its authenticated link to the login EOA, execution signer, chosen market's paper-credit eligibility, order size and fresh order-specific preflight are not established. A direct M2 EOA order cannot use the trading wallet's MarginBank by assumption. The safest next step is for the owner to confirm the active Wallet 1 public address and paper-credit-eligible market in dreamDEX, then run a read-only order-specific preflight. No funds need to be moved based solely on these observations. For Arena rewards, [official rules](https://app.testnet.dreamdex.io/competition) separately require 10 mainnet SOMI in the mainnet dreamDEX wallet or signup wallet; neither of the two supplied addresses had mainnet SOMI in this sample, and the app mainnet wallet was not identified. This rewards condition is separate from placing a testnet perp order.

Statuses: `READY` means a verified read or supported network compatibility, **not** trade authorization. `BLOCKED` indicates observed missing gas/collateral. `UNKNOWN` means evidence is incomplete or stale. `RPC_ERROR` preserves an unread balance as unknown. `UNSUPPORTED` means wrong chain, missing contract, or no verified capability. M2.4 never returns trade-level `READY` without signer, market, order and preflight evidence.

# Verified on-chain evidence

## First order

| Fact | Verified value | Source |
| --- | --- | --- |
| Network | Somnia Hideki, chain ID 50383 | Independent RPC chain read and proof bundle |
| Plan hash | `c48415ec3cc8cba6392294529f650c4be7a925b66f5f4b03f33eb6ad9cd52ed2` | Saved plan in proof bundle |
| Transaction | `0x45cca8d50aead7a4734849759cd1f5699112fea0feb938f6bdd0e8ae2cc0f121` | RPC receipt and proof bundle |
| Order ID | `14978756187852164026332` | `OrderPlaced` event |
| Placement block | `34465778` | RPC receipt and both order events |
| Placement result | `ONCHAIN_SUCCESS / RESTED_AT_PLACEMENT` | Receipt status `0x1`, `OrderPlaced`, `OrderRested` |
| Gas used | 995957 units | RPC receipt |
| Proof hash | `4230656d134ca6644edfbbcd5ec97468e8381e672c78bdb5ddd5730518d20e92` | Canonical SHA-256 of local proof bundle |

Proof bundle: [`canary-proofs/canary-proof-1793098877887-4230656d134c.json`](../canary-proofs/canary-proof-1793098877887-4230656d134c.json). The terminal validates its hash, plan identity, receipt, and matching `OrderPlaced` and `OrderRested` logs before display.

## Lifecycle after placement

The on-chain placement receipt has `OrderPlaced` at log index 1 and `OrderRested` at log index 2, both in block **34465778**. A later independent open-order read at block **34476413** found no matching BTC-PERP order; the wallet position was **0.05416 BTC**. An indexed Hideki RPC scan from the placement block through block **34476408** found no matching `OrderFilled`, `OrderCancelled`, `OrderExpired`, `OrderReduced`, or protocol cancellation event. The UI rescans and displays the current scan and read blocks on each refresh. The order's **current state is `NOT_OPEN_AT_READ` and disappearance cause is `UNKNOWN`**. No fill, cancellation, or expiry is asserted. Natural time expiry without an emitted event is a possibility, not a verified cause.

Each RPC log is filtered by the exact order ID and BTC-PERP pool; fills are queried in both taker and maker indexed positions. The scan uses bounded 1000-block ranges and an incremental in-memory cursor. An RPC failure keeps the history `UNKNOWN` instead of claiming a complete scan. The current position is always sourced from a fresh SDK on-chain read, never inferred from the order.

Run the independent read-only check:

```powershell
npm.cmd run canary-status -- c48415ec3cc8cba6392294529f650c4be7a925b66f5f4b03f33eb6ad9cd52ed2
```

The proof proves placement and resting at that block. It does not prove perpetual order openness, future execution, PnL, or a delegated close. The proof's simulation and final revalidation descriptions are bounded to what was persisted; see the JSON for exact provenance.

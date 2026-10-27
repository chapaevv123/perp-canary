# Hackathon submission draft — Perp Canary

**Project:** Perp Canary — a verifiable BTC-PERP risk and execution companion for dreamDEX on Somnia Hideki.

**Problem:** A trading UI can show a quote or a successful transaction without making clear whether an order was safe to send, actually placed, rested, filled, or later disappeared. Perp Canary ties live on-chain and SDK reads to a hash-bound owner plan and a receipt-backed proof.

**Demo:** A compact local terminal shows live mark and top-of-book prices, wallet position and open orders, delegated place permission, risk readiness, and a real order timeline. Its chart records only quotes observed after opening the page. The browser is read-only. A separate owner CLI runs a 300-second BUY PostOnly plan with exact confirmation and a repeated final preflight.

**Verified on-chain result:** The first real order was accepted on Hideki 50383 in block 34465778, transaction `0x45cca8d50aead7a4734849759cd1f5699112fea0feb938f6bdd0e8ae2cc0f121`, order ID `14978756187852164026332`. The receipt succeeded; `OrderPlaced` and `OrderRested` match the BTC-PERP pool and owner. The proof bundle hash is `4230656d134ca6644edfbbcd5ec97468e8381e672c78bdb5ddd5730518d20e92`.

**Safety:** TRUSTED market snapshot, margin and SDK maximum size, grants, nonce, gas under 0.1 STT, notional under 100 USDso, mark deviation under 1%, simulation, 300-second expiry, exact hash confirmation, idempotency, and final preflight are enforced in the existing local CLI. No password, key, or signed raw transaction enters the browser.

**Limits and honest claims:** The first order later became `NOT_OPEN_AT_READ`; no matching fill/cancel/expiry event was seen through the scanned block, so the cause remains `UNKNOWN`. The browser is not an order entry surface. SELL, IOC, automatic cancel, and delegated position close are not claimed as proven. Historical candles, volume, and PnL are not fabricated. Eligibility, final submission URL, and external judging requirements still need owner review.

**Before submission:** Record a short read-only walkthrough, recheck the first-order lifecycle and current position, confirm the official bounty rules and eligibility, publish only after owner approval, then replace this draft with the final submission text.

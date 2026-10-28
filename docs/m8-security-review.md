# M8 security and privacy review

## Boundaries retained

Somnia Hideki chain identity and SDK genesis checks remain mandatory. Public mode requires an exact HTTPS origin, Host/Origin checks, route allowlist and rate limits. The browser uses EIP-1193 only for explicit wallet interactions; M8 added no signing key, automatic trade, or server-side broadcast. Every wallet order still goes through fresh book, owner/operator grant, margin, gas, nonce, expiry and contract-simulation checks.

Radar and Journal use read-only endpoints. Journal account histories are on-chain/indexed public data, but the UI only requests the connected wallet's address and selected account mode. The historical Replay artifact contains public testnet hashes and addresses. CSV export contains only displayed public order fields and escapes spreadsheet formula prefixes. It includes neither secrets nor local alert rules.

Alerts and trigger history are stored in the browser's localStorage under an account scope. No alert configuration is sent to a shared server, and there is no background server worker. Browser profile sharing exposes local data to anyone using that profile; use separate browser profiles for separate users. The app does not claim authenticated multi-user server storage. A future server-side alert service requires authenticated wallet binding, encrypted tenant storage, quotas, audit logs and explicit notification consent.

M8 Radar is manual for all 21 markets, at most two snapshot calls at once. Open-tab alert monitoring evaluates only enabled-alert markets every 60 seconds while visible. Each request has a browser deadline; the server SDK path has its own bounded deadlines. The old historical full-range RPC scan was removed because it could issue thousands of calls. The replacement explicitly reports partial lifecycle evidence instead of inferring a fill.

## Release gates

- Inspect production environment for exact HTTPS origin and reverse-proxy Host behavior.
- Perform public-mode smoke on the approved domain, including rejected cross-origin POST and disallowed paths.
- Confirm localStorage privacy wording and user data deletion policy for a shared public demo.
- Verify deployed container contains only reviewed public evidence and no private keys or ignored directories.
- Obtain explicit owner approval before GitHub push or deployment.

# MetaMask site warning review request — draft for owner

**Submit through:** https://github.com/MetaMask/eth-phishing-detect/issues (MetaMask's [site-warning guidance](https://support.metamask.io/ru/stay-safe/safety-in-web3/deceptive-site-ahead-when-trying-to-connect-to-a-site/)). If the warning is a transaction security alert or a different classifier, use [MetaMask Support](https://support.metamask.io/privacy-and-security/how-to-turn-on-security-alerts/) and include the exact alert screenshot.

**Subject:** Review request for `perp-canary.onrender.com` site warning

**Draft:**

> Please review the MetaMask warning shown for https://perp-canary.onrender.com/. Perp Canary is an open-source Somnia Hideki testnet perps research and guarded order-planning app for the dreamDEX Builder Bounty. Source: https://github.com/chapaevv123/perp-canary. The public page serves first-party scripts under a self-only Content Security Policy. A wallet connection requires a user click and requests `eth_requestAccounts`; a transaction requires a separate review and explicit `eth_sendTransaction` wallet confirmation. The app does not ask for seed phrases, private keys or message signatures. The server returns unsigned plans and does not broadcast user trades. We have not identified a malicious redirect or external script in the audited release. MetaMask's official Why Blocked utility reported “This domain is not blocked” on 2026-10-28, while a warning was reported in a MetaMask session. Please identify the warning's source and review the URL. We are withholding wallet connection on the flagged URL until this is resolved. Screenshot, exact URL, browser/extension version, time and network: [OWNER TO ATTACH].

This is a request for investigation, not a claim that the warning is a false positive. Do not post account secrets, private keys or seed phrases in the issue.

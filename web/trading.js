/* EIP-1193 direct-wallet flow. The local server only reads and prepares unsigned calls. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { provider: null, account: null, chainId: null, accountData: null,
    side: 'BUY', market: null, plan: null, busy: false, pendingHash: null, pendingAccount: null, requestId: 0 };
  const panel = document.querySelector('.trade-panel');
  panel.querySelector('.eyebrow').textContent = 'DIRECT WALLET TRADING';
  panel.querySelector('h2').textContent = 'Trade BTC-PERP';
  panel.querySelector('.badge').textContent = 'WALLET APPROVAL';
  panel.querySelector('.trade-callout strong').textContent = 'Every order requires your wallet confirmation.';
  panel.querySelector('.trade-callout span').textContent =
    'Perp Canary prepares and simulates a direct pool call. Your connected wallet signs and sends it only after review.';
  $('sell').title = 'SELL PostOnly can open or add to a short; this is not reduce-only.';
  $('use-ask').title = 'Available for SELL PostOnly. For BUY it would cross the book.';
  $('copy-prepare').textContent = 'Copy separate owner CLI command';
  $('copy-prepare').classList.remove('primary');
  $('copy-prepare').classList.add('secondary');
  const workflow = document.createElement('div'); workflow.className = 'wallet-workflow';
  workflow.innerHTML = `
    <div class="wallet-summary"><strong id="wallet-state">Connect an EIP-1193 wallet to trade directly.</strong>
      <span id="wallet-balances">Wallet balance and MarginBank: not read</span></div>
    <div class="guard-card"><span>CANARY TRADE GUARD</span><strong id="guard-verdict">UNKNOWN</strong>
      <p id="guard-explanation">A fresh quote, wallet balance, margin size and contract simulation are required.</p></div>
    <button id="review-order" class="button primary full" type="button" disabled>Review wallet order</button>
    <div id="trade-review" class="review-card" hidden>
      <h3>Review direct BTC-PERP order</h3><p id="review-details"></p>
      <p id="review-risk"></p><p id="review-contract"></p>
      <div class="review-actions"><button id="confirm-wallet" class="button primary" type="button">Confirm in wallet</button>
        <button id="dismiss-review" class="button secondary" type="button">Edit order</button></div>
    </div><p id="wallet-result" class="wallet-result" role="status" aria-live="polite"></p>
    <div class="wallet-position"><strong>Your BTC-PERP account</strong><p id="wallet-position">Connect a wallet to read your own position and open orders.</p>
      <div id="wallet-orders"></div></div>`;
  panel.querySelector('.trade-facts').before(workflow);
  const status = (message, kind = '') => { $('wallet-result').textContent = message; $('wallet-result').dataset.kind = kind; };
  const text = (id, value) => { $(id).textContent = value; };
  const validChain = () => state.chainId === 50383;
  const connected = () => !!state.account && validChain();
  const request = async (url, options) => {
    const controller = new window.AbortController();
    const timer = setTimeout(() => controller.abort(), 100000);
    try { const response = await fetch(url, { cache: 'no-store', signal: controller.signal, ...options });
      const body = await response.json();
      if (!response.ok) throw Error(body.error || `HTTP ${response.status}`);
      return body;
    } finally { window.clearTimeout(timer); }
  };
  function input() { return { account: state.account, side: state.side, orderType: 'POST_ONLY',
    price: $('limit-price').value.trim(), quantity: $('quantity').value.trim() }; }
  function invalidate() {
    state.plan = null; $('trade-review').hidden = true;
    $('review-order').disabled = !connected() || state.busy || !!state.pendingHash;
    $('confirm-wallet').disabled = true;
    text('guard-verdict', 'UNKNOWN');
    $('guard-verdict').dataset.verdict = 'UNKNOWN';
    text('guard-explanation', 'Review runs a fresh trusted-book, margin, gas and contract-simulation preflight.');
  }
  function displayAccount() {
    $('wallet-connect').hidden = !!state.account;
    $('wallet-disconnect').hidden = !state.account;
    $('wallet-switch').hidden = !state.account || validChain();
    text('wallet-state', state.account ? `${state.account.slice(0, 6)}…${state.account.slice(-4)} · ${validChain() ? 'Hideki 50383' : 'wrong network'}` :
      'Connect an EIP-1193 wallet to trade directly.');
    if (!state.account) { text('wallet-balances', 'Wallet balance and MarginBank: not read');
      text('wallet-position', 'Connect a wallet to read your own position and open orders.');
      $('wallet-orders').replaceChildren(); }
    invalidate();
  }
  async function loadAccount() {
    if (!connected()) return;
    const id = ++state.requestId;
    text('wallet-balances', 'Reading this wallet’s balances and MarginBank…');
    try { const data = await request(`/api/v1/trade/account?account=${encodeURIComponent(state.account)}`);
      if (id !== state.requestId || data.account.toLowerCase() !== state.account.toLowerCase()) return;
      state.accountData = data;
      text('wallet-balances', `STT ${data.gasStt} · USDso ${data.walletUsdso} · margin free ${data.marginUnlocked}`);
      text('wallet-position', `Position ${data.position.sizeBtc} BTC · entry ${data.position.entryPrice} USDso · ${data.openOrders.length} open orders (block ${data.block})`);
      const rows = data.openOrders.map(order => {
        const row = document.createElement('div'); row.className = 'wallet-order-row';
        row.textContent = `#${order.id} · ${order.side} ${order.remaining} BTC @ ${order.price} USDso`;
        return row;
      });
      $('wallet-orders').replaceChildren(...rows);
    } catch (error) { if (id === state.requestId) {
      state.accountData = null; text('wallet-balances', `Account read unavailable: ${error.message}`);
      text('wallet-position', 'Position and open orders UNKNOWN. Refresh when RPC/SDK is available.');
      $('wallet-orders').replaceChildren(); } }
  }
  function onAccounts(accounts) {
    const next = Array.isArray(accounts) && /^0x[0-9a-fA-F]{40}$/.test(accounts[0] ?? '') ? accounts[0] : null;
    if (next?.toLowerCase() === state.account?.toLowerCase()) return;
    state.account = next; state.accountData = null; state.requestId++; displayAccount();
    if (connected()) loadAccount();
  }
  async function onChain(hex) {
    const parsed = Number(hex); state.chainId = Number.isInteger(parsed) ? parsed : null;
    state.accountData = null; state.requestId++; displayAccount();
    if (connected()) await loadAccount();
  }
  $('wallet-connect').onclick = async () => {
    const provider = window.ethereum;
    if (!provider?.request) { status('No injected EIP-1193 wallet found. Install or enable a compatible wallet.', 'error'); return; }
    $('wallet-connect').disabled = true;
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (!Array.isArray(accounts) || !accounts.length) throw Error('Wallet returned no account.');
      state.provider = provider;
      provider.on?.('accountsChanged', onAccounts);
      provider.on?.('chainChanged', onChain);
      onAccounts(accounts);
      await onChain(await provider.request({ method: 'eth_chainId' }));
      status(validChain() ? 'Wallet connected. Review an order before any wallet prompt.' :
        'Wallet connected on another network. Switch to Hideki 50383.', validChain() ? 'ok' : 'warn');
    } catch (error) { status(`Wallet connection failed: ${error.message}`, 'error'); }
    finally { $('wallet-connect').disabled = false; }
  };
  $('wallet-switch').onclick = async () => {
    try { await state.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xc4cf' }] }); }
    catch (error) { if (error.code === 4902) {
      try { await state.provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0xc4cf',
        chainName: 'Somnia Hideki Testnet', nativeCurrency: { name: 'Test STT', symbol: 'STT', decimals: 18 },
        rpcUrls: ['https://api.hideki2.infra.testnet.somnia.network'],
        blockExplorerUrls: ['https://explorer.testnet.somnia.network/tokyo'] }] }); }
      catch (addError) { status(`Network addition rejected: ${addError.message}`, 'error'); return; }
    } else { status(`Network switch rejected: ${error.message}`, 'error'); return; } }
    await onChain(await state.provider.request({ method: 'eth_chainId' }));
  };
  $('wallet-disconnect').onclick = () => {
    state.provider?.removeListener?.('accountsChanged', onAccounts);
    state.provider?.removeListener?.('chainChanged', onChain);
    state.provider = null; state.account = null; state.chainId = null; state.accountData = null;
    state.requestId++; displayAccount(); status('Application wallet session disconnected.');
  };
  for (const id of ['quantity', 'limit-price']) $(id).addEventListener('input', invalidate);
  window.addEventListener('canary:side', event => { state.side = event.detail; invalidate(); });
  window.addEventListener('canary:market', event => { state.market = event.detail; invalidate(); });
  $('market-select').onchange = () => { invalidate(); status('BTC-PERP is the only verified market in this release.'); };
  $('refresh').addEventListener('click', async () => {
    if (connected()) loadAccount();
    if (state.pendingHash && state.pendingAccount) {
      try { const receipt = await request(`/api/v1/trade/receipt?hash=${encodeURIComponent(state.pendingHash)}&account=${encodeURIComponent(state.pendingAccount)}`);
        if (receipt.state === 'PENDING') status(`Transaction ${state.pendingHash} is still pending.`, 'warn');
        else { status(receipt.state === 'PLACED' ?
          `On-chain placement confirmed: order #${receipt.orderId}, block ${receipt.block}.` :
          `Transaction ${receipt.state}: ${receipt.reason ?? `block ${receipt.block}`}`,
        receipt.state === 'PLACED' ? 'ok' : 'error'); state.pendingHash = null; state.pendingAccount = null;
          $('review-order').disabled = !connected(); }
      } catch (error) { status(`Receipt read unavailable: ${error.message}`, 'error'); }
    }
  });
  $('review-order').onclick = async () => {
    if (!connected() || state.busy || state.pendingHash) return;
    state.plan = null; $('trade-review').hidden = true; $('confirm-wallet').disabled = true;
    state.busy = true; $('review-order').disabled = true; status('Running Canary Trade Guard and contract simulation…');
    const draft = input();
    try {
      const plan = await request('/api/v1/trade/prepare', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft) });
      if (!connected() || draft.account.toLowerCase() !== state.account.toLowerCase() ||
        draft.side !== state.side || draft.price !== $('limit-price').value.trim() ||
        draft.quantity !== $('quantity').value.trim()) throw Error('Wallet or order changed during review. Start again.');
      text('guard-verdict', plan.guard.verdict);
      $('guard-verdict').dataset.verdict = plan.guard.verdict;
      text('guard-explanation', [...plan.guard.blockers, ...plan.guard.warnings].join(' ') ||
        'Trusted book, price grid, margin size, gas budget and contract simulation passed.');
      if (plan.status !== 'READY' || !plan.transaction) { status('Order blocked by Canary Trade Guard.', 'error'); return; }
      state.plan = { input: draft, result: plan };
      text('review-details', `${draft.side} ${draft.quantity} BTC-PERP @ ${draft.price} USDso · PostOnly · estimated notional ${
        (Number(plan.guard.notionalRaw) / 1e18).toFixed(2)} USDso`);
      text('review-risk', `Guard ${plan.guard.verdict}. ${plan.guard.warnings.join(' ') || 'No observed caution.'} Max simulated gas cost ${plan.transaction.maxGasCostStt} STT.`);
      text('review-contract', `Hideki 50383 · pool ${plan.transaction.to} · from ${plan.transaction.from} · expires ${plan.transaction.expiresAt}`);
      $('trade-review').hidden = false; $('confirm-wallet').disabled = false;
      status('Review the exact wallet order, then confirm explicitly.', 'ok');
    } catch (error) { status(`Review unavailable: ${error.message}`, 'error'); invalidate(); }
    finally { state.busy = false; $('review-order').disabled = !connected() || !!state.pendingHash; }
  };
  $('dismiss-review').onclick = () => { invalidate(); status('Order review closed.'); };
  $('confirm-wallet').onclick = async () => {
    if (!state.plan || state.busy || !connected()) return;
    const reviewed = state.plan; state.busy = true; $('confirm-wallet').disabled = true;
    $('review-order').disabled = true; status('Rechecking market, margin and exact contract call…');
    try {
      const chain = Number(await state.provider.request({ method: 'eth_chainId' }));
      if (chain !== 50383 || chain !== state.chainId) throw Error('Wallet chain changed.');
      const accounts = await state.provider.request({ method: 'eth_accounts' });
      if (!accounts.some(value => value.toLowerCase() === reviewed.input.account.toLowerCase())) throw Error('Wallet account changed.');
      const fresh = await request('/api/v1/trade/prepare', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...reviewed.input, expiresAt: Date.parse(reviewed.result.transaction.expiresAt) }) });
      const oldTx = reviewed.result.transaction, tx = fresh.transaction;
      if (fresh.status !== 'READY' || !tx || tx.data !== oldTx.data ||
        tx.to.toLowerCase() !== oldTx.to.toLowerCase() || tx.from.toLowerCase() !== oldTx.from.toLowerCase() ||
        tx.chainId !== 50383 || tx.value !== '0x0' || tx.gas !== oldTx.gas ||
        !connected()) throw Error('Fresh preflight differs or is blocked. Review a new order.');
      status('Waiting for your explicit wallet confirmation…', 'warn');
      const hash = await state.provider.request({ method: 'eth_sendTransaction', params: [{
        from: tx.from, to: tx.to, data: tx.data, value: tx.value, gas: tx.gas }] });
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw Error('Wallet returned an invalid transaction hash.');
      state.pendingHash = hash; state.pendingAccount = tx.from; state.plan = null; $('trade-review').hidden = true;
      status(`Submitted ${hash}. Waiting for an independently read receipt…`, 'warn');
      for (let attempt = 0; attempt < 12; attempt++) {
        const receipt = await request(`/api/v1/trade/receipt?hash=${encodeURIComponent(hash)}&account=${encodeURIComponent(tx.from)}`);
        if (receipt.state !== 'PENDING') { state.pendingHash = null; state.pendingAccount = null;
          status(receipt.state === 'PLACED' ?
          `On-chain placement confirmed: order #${receipt.orderId}, block ${receipt.block}. Current open/fill state is separate.` :
          `Transaction ${receipt.state}: ${receipt.reason ?? `block ${receipt.block}`}`, receipt.state === 'PLACED' ? 'ok' : 'error');
          await loadAccount(); return; }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      status(`Transaction ${hash} remains pending. Refresh to recheck the account.`, 'warn');
    } catch (error) { status(`Wallet trade stopped: ${error.message}`, 'error'); invalidate(); }
    finally { state.busy = false; $('review-order').disabled = !connected() || !!state.pendingHash; }
  };
  displayAccount();
})();

/* EIP-1193 direct-wallet flow. The local server only reads and prepares unsigned calls. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { provider: null, account: null, chainId: null, accountData: null,
    side: 'BUY', market: null, plan: null, busy: false, pendingHash: null, pendingAccount: null,
    pendingMarket: null, requestId: 0, marketRegistry: [] };
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
    <div class="radar-card"><span>CANARY MARKET RADAR</span><strong id="radar-state">UNKNOWN</strong>
      <p id="radar-details">Waiting for independently checked live data.</p>
      <p id="radar-monitoring">In-tab monitoring active while this page remains open.</p>
      <div id="radar-alerts"></div></div>
    <div class="guard-card"><span>CANARY TRADE GUARD</span><strong id="guard-verdict">UNKNOWN</strong>
      <p id="guard-explanation">A fresh quote, wallet balance, margin size and contract simulation are required.</p></div>
    <button id="review-order" class="button primary full" type="button" disabled>Review wallet order</button>
    <div id="trade-review" class="review-card" hidden>
      <h3>Review direct BTC-PERP order</h3><p id="review-details"></p>
      <p id="review-risk"></p><p id="review-contract"></p>
      <div class="review-actions"><button id="confirm-wallet" class="button primary" type="button">Confirm in wallet</button>
        <button id="dismiss-review" class="button secondary" type="button">Edit order</button></div>
    </div><p id="wallet-result" class="wallet-result" role="status" aria-live="polite"></p>
    <div class="sizing-card"><strong>Smart position sizing</strong>
      <p>Reference calculation only. A stop reference does not install a stop order.</p>
      <div class="sizing-fields"><label>Capital (USDso)<input id="size-capital" type="text" inputmode="decimal" placeholder="100"></label>
        <label>Risk (%)<input id="size-risk" type="text" inputmode="decimal" placeholder="1"></label>
        <label>Stop reference<input id="size-stop" type="text" inputmode="decimal" placeholder="Price"></label></div>
      <button id="calculate-size" class="button secondary full" type="button">Calculate from current entry</button>
      <p id="size-result" role="status" aria-live="polite">Enter capital, risk, a limit entry and stop reference.</p>
      <button id="use-sized-quantity" class="button secondary full" type="button" disabled>Use calculated quantity</button></div>
    <div class="wallet-position"><strong>Your selected-market account</strong><p id="wallet-position">Connect a wallet to read your own position and open orders.</p>
      <div id="wallet-orders"></div></div>
    <div class="wallet-actions"><strong>Manage margin and orders</strong>
      <p>Each action has its own simulation, review and wallet confirmation. Approval is bounded to the entered amount.</p>
      <label>Action <select id="wallet-action"><option value="APPROVE">Approve exact USDso</option>
        <option value="DEPOSIT">Deposit margin</option><option value="WITHDRAW">Withdraw free margin</option>
        <option value="CANCEL">Cancel selected order</option></select></label>
      <label>Amount (USDso) <input id="action-amount" type="text" inputmode="decimal" placeholder="10"></label>
      <label id="action-order-label" hidden>Selected order ID <input id="action-order-id" type="text" readonly></label>
      <button id="review-action" class="button secondary full" type="button" disabled>Review wallet action</button>
      <div id="action-review" class="review-card" hidden><h3>Review wallet action</h3>
        <p id="action-details"></p><p id="action-contract"></p>
        <div class="review-actions"><button id="confirm-action" class="button primary" type="button">Confirm in wallet</button>
          <button id="dismiss-action" class="button secondary" type="button">Edit action</button></div></div>
      <p id="action-result" class="wallet-result" role="status" aria-live="polite"></p></div>
    <div class="wallet-journal"><strong>Trade Review</strong>
      <p id="trade-review-summary">Awaiting a wallet transaction receipt. Placement, current open state and fills are separate facts.</p>
      <strong>On-chain trade journal</strong>
      <p>Local public transaction references; states come from independently read receipts and open orders.</p>
      <div id="journal-entries">No wallet transactions from this browser session.</div></div>
    <div class="wallet-journal"><strong>Canary AI Copilot</strong>
      <p>Unavailable: no model service is connected. Guard, Radar and sizing use disclosed deterministic checks; they do not generate AI advice.</p></div>`;
  panel.querySelector('.trade-facts').before(workflow);
  const status = (message, kind = '') => { $('wallet-result').textContent = message; $('wallet-result').dataset.kind = kind; };
  const actionStatus = (message, kind = '') => { $('action-result').textContent = message;
    $('action-result').dataset.kind = kind; };
  const text = (id, value) => { $(id).textContent = value; };
  const validChain = () => state.chainId === 50383;
  const connected = () => !!state.account && validChain();
  const journalKey = 'perp-canary/trade-journal/v1';
  function readJournal() { try { const rows = JSON.parse(window.localStorage.getItem(journalKey) || '[]');
    return Array.isArray(rows) ? rows.filter(row => row && typeof row.hash === 'string').slice(0, 100) : []; }
  catch { return []; } }
  function renderJournal() {
    const rows = readJournal().filter(row => typeof row.account === 'string' &&
      (!state.account || row.account.toLowerCase() === state.account.toLowerCase()));
    const elements = rows.slice(0, 12).map(row => {
      const div = document.createElement('div'); div.className = 'journal-entry';
      div.textContent = `${row.market} · ${row.action} · ${row.state} · ${row.hash.slice(0, 12)}… · ${new Date(row.at).toLocaleString()}${row.orderId ? ` · #${row.orderId}` : ''}`;
      div.title = `${row.hash} · source ${row.source ?? 'WALLET_SUBMISSION'}`;
      return div;
    });
    $('journal-entries').replaceChildren(...elements);
    if (!elements.length) text('journal-entries', 'No wallet transactions recorded in this browser.');
    const latestPlace = rows.find(row => row.action === 'PLACE');
    if (latestPlace) text('trade-review-summary', `${latestPlace.market} ${latestPlace.side} ${latestPlace.quantity} @ ${latestPlace.price} USDso: ${latestPlace.state}. ${
      latestPlace.orderId ? `Order #${latestPlace.orderId}. ` : ''}${
      latestPlace.outcomeAtPlacement === 'RESTED_AT_PLACEMENT' ? 'Receipt observed a rest event at placement. ' : ''}
      Current fill and PnL require separate on-chain evidence.`);
  }
  function recordJournal(hash, update) {
    const rows = readJournal();
    const existing = rows.find(row => row.hash.toLowerCase() === hash.toLowerCase());
    if (existing) Object.assign(existing, update);
    else rows.unshift({ hash, account: update.account, market: update.market,
      action: update.action, state: 'SUBMITTED', at: new Date().toISOString(), source: 'WALLET_SUBMISSION', ...update });
    try { window.localStorage.setItem(journalKey, JSON.stringify(rows.slice(0, 100))); } catch { /* optional local persistence */ }
    renderJournal();
  }
  const request = async (url, options) => {
    const controller = new window.AbortController();
    const timer = setTimeout(() => controller.abort(), 100000);
    try { const response = await fetch(url, { cache: 'no-store', signal: controller.signal, ...options });
      const body = await response.json();
      if (!response.ok) throw Error(body.error || `HTTP ${response.status}`);
      return body;
    } finally { window.clearTimeout(timer); }
  };
  function input() { return { account: state.account, market: $('market-select').value,
    side: state.side, orderType: 'POST_ONLY',
    price: $('limit-price').value.trim(), quantity: $('quantity').value.trim() }; }
  function invalidate() {
    state.plan = null; $('trade-review').hidden = true;
    $('review-order').disabled = !connected() || state.busy || !!state.pendingHash || !!state.actionPending;
    $('confirm-wallet').disabled = true;
    text('guard-verdict', 'UNKNOWN');
    $('guard-verdict').dataset.verdict = 'UNKNOWN';
    text('guard-explanation', 'Review runs a fresh trusted-book, margin, gas and contract-simulation preflight.');
    invalidateAction();
  }
  function invalidateAction() {
    state.actionPlan = null; $('action-review').hidden = true; $('confirm-action').disabled = true;
    $('review-action').disabled = !connected() || state.busy || !!state.pendingHash || !!state.actionPending;
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
    renderJournal();
    invalidate();
  }
  async function loadAccount() {
    if (!connected()) return;
    const id = ++state.requestId;
    const selectedMarket = $('market-select').value;
    text('wallet-balances', 'Reading this wallet’s balances and MarginBank…');
    try { const data = await request(`/api/v1/trade/account?account=${encodeURIComponent(state.account)}&market=${encodeURIComponent(selectedMarket)}`);
      if (id !== state.requestId || data.account.toLowerCase() !== state.account.toLowerCase() ||
        selectedMarket !== $('market-select').value) return;
      state.accountData = data;
      text('wallet-balances', `STT ${data.gasStt} · USDso ${data.walletUsdso} · allowance ${data.allowance ?? 'UNKNOWN'} · margin free ${data.marginUnlocked} · withdrawable ${data.withdrawable ?? 'UNKNOWN'}`);
      text('wallet-position', `Position ${data.position.size ?? data.position.sizeBtc} ${data.market?.replace('-PERP', '') ?? 'BTC'} · entry ${data.position.entryPrice} USDso · ${data.openOrders.length} open orders (block ${data.block})`);
      const rows = data.openOrders.map(order => {
        const row = document.createElement('div'); row.className = 'wallet-order-row';
        const detail = document.createElement('span');
        detail.textContent = `#${order.id} · ${order.side} ${order.remaining} ${data.market?.replace('-PERP', '') ?? 'BTC'} @ ${order.price} USDso`;
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'button secondary';
        cancel.textContent = 'Review cancel'; cancel.onclick = () => {
          $('wallet-action').value = 'CANCEL'; $('action-order-id').value = order.id;
          $('action-order-label').hidden = false; $('action-amount').parentElement.hidden = true;
          invalidateAction(); $('review-action').focus();
        };
        row.append(detail, cancel);
        return row;
      });
      $('wallet-orders').replaceChildren(...rows);
      for (const entry of readJournal()) {
        if (entry.account?.toLowerCase() === data.account.toLowerCase() && entry.market === data.market &&
          entry.action === 'PLACE' && entry.orderId) {
          if (data.openOrders.some(order => order.id === entry.orderId))
            recordJournal(entry.hash, { state: 'RESTING', source: `SDK_OPEN_ORDERS_BLOCK_${data.block}` });
          else if (entry.state === 'RESTING') recordJournal(entry.hash, {
            state: 'UNKNOWN', source: `NOT_OPEN_AT_BLOCK_${data.block}` });
        }
      }
    } catch (error) { if (id === state.requestId) {
      state.accountData = null; text('wallet-balances', `Account read unavailable: ${error.message}`);
      text('wallet-position', 'Position and open orders UNKNOWN. Refresh when RPC/SDK is available.');
      $('wallet-orders').replaceChildren(); } }
  }
  async function loadMarkets() {
    try { const result = await request('/api/v1/markets');
      const markets = result.markets;
      if (!Array.isArray(markets) || !markets.some(row => row.symbol === 'BTC-PERP')) throw Error('BTC market missing');
      state.marketRegistry = markets;
      const previous = $('market-select').value;
      const options = markets.sort((a, b) => a.symbol === 'BTC-PERP' ? -1 : b.symbol === 'BTC-PERP' ? 1 :
        a.symbol.localeCompare(b.symbol)).map(row => {
        const option = document.createElement('option'); option.value = row.symbol;
        option.textContent = `${row.symbol} / ${row.quote}${row.status === 'TRADEABLE' ? '' : ` (${row.status})`}`;
        option.disabled = row.status !== 'TRADEABLE'; return option;
      });
      $('market-select').replaceChildren(...options);
      if (options.some(option => option.value === previous && !option.disabled)) $('market-select').value = previous;
      status(`${markets.filter(row => row.status === 'TRADEABLE').length} markets passed SDK and factory status checks.`, 'ok');
    } catch (error) { status(`Market registry unavailable: ${error.message}. BTC-only view remains.`, 'warn'); }
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
  window.addEventListener('canary:side', event => { state.side = event.detail; state.sizedQuantity = null;
    $('use-sized-quantity').disabled = true; invalidate(); });
  window.addEventListener('canary:market', event => {
    state.market = event.detail; invalidate(); state.sizedQuantity = null;
    $('use-sized-quantity').disabled = true;
    const radar = event.detail?.radar;
    text('radar-state', radar?.status ?? 'UNKNOWN');
    text('radar-details', radar?.status === 'UNKNOWN' || !radar ?
      'Trusted live data is unavailable; no market signal is claimed.' :
      `Spread ${radar.spreadBps.toFixed(1)} bps · visible bid share ${radar.imbalancePercent === null ? 'UNKNOWN' : `${radar.imbalancePercent.toFixed(0)}%`} · mark change ${radar.priceChangeBps === null ? 'UNKNOWN' : `${radar.priceChangeBps.toFixed(1)} bps`}.`);
    $('radar-state').dataset.status = radar?.status ?? 'UNKNOWN';
    $('radar-alerts').replaceChildren(...(radar?.alerts ?? []).map(message => {
      const item = document.createElement('p'); item.textContent = message; return item;
    }));
  });
  $('calculate-size').onclick = async () => {
    state.sizedQuantity = null; $('use-sized-quantity').disabled = true;
    text('size-result', 'Calculating with verified market tick and lot…');
    const draft = { market: $('market-select').value, side: state.side, capital: $('size-capital').value.trim(),
      riskPercent: $('size-risk').value.trim(), entry: $('limit-price').value.trim(),
      stop: $('size-stop').value.trim() };
    try { const result = await request('/api/v1/intelligence/size', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) });
      if (draft.market !== $('market-select').value || draft.side !== state.side ||
        draft.entry !== $('limit-price').value.trim()) throw Error('Market, side or entry changed; calculate again');
      text('size-result', `${result.status}: ${result.quantity} ${$('market-select').value.replace('-PERP', '')} · notional ${result.notionalUsdso} USDso · estimated initial margin ${result.initialMarginUsdso} USDso · loss at stop reference ${result.lossAtStopUsdso} USDso. ${result.assumptions}`);
      if (result.status === 'CALCULATED') { state.sizedQuantity = result.quantity;
        $('use-sized-quantity').disabled = false; }
    } catch (error) { text('size-result', `Sizing unavailable: ${error.message}`); }
  };
  $('use-sized-quantity').onclick = () => { if (!state.sizedQuantity) return;
    $('quantity').value = state.sizedQuantity; $('quantity').dispatchEvent(new window.Event('input', { bubbles: true })); };
  for (const id of ['size-capital', 'size-risk', 'size-stop', 'limit-price']) $(id).addEventListener('input', () => {
    state.sizedQuantity = null; $('use-sized-quantity').disabled = true;
  });
  $('market-select').onchange = () => { state.accountData = null; state.requestId++; invalidate();
    panel.querySelector('h2').textContent = `Trade ${$('market-select').value}`;
    $('trade-review').querySelector('h3').textContent = `Review direct ${$('market-select').value} order`;
    status(`Loading verified ${$('market-select').value} market…`);
    text('wallet-position', 'Reading selected market position and orders…');
    if (connected()) loadAccount(); };
  $('wallet-action').onchange = () => {
    const cancel = $('wallet-action').value === 'CANCEL';
    $('action-order-label').hidden = !cancel; $('action-amount').parentElement.hidden = cancel;
    if (!cancel) $('action-order-id').value = '';
    invalidateAction();
  };
  $('action-amount').oninput = invalidateAction;
  function actionDraft() { return { account: state.account, market: $('market-select').value,
    action: $('wallet-action').value, amount: $('action-amount').value.trim(),
    orderId: $('action-order-id').value.trim() }; }
  $('review-action').onclick = async () => {
    if (!connected() || state.busy || state.pendingHash || state.actionPending) return;
    invalidateAction(); state.busy = true; $('review-action').disabled = true;
    const draft = actionDraft(); actionStatus('Simulating exact wallet action…', 'warn');
    try { const plan = await request('/api/v1/trade/action/prepare', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) });
      if (!connected() || draft.account.toLowerCase() !== state.account.toLowerCase() ||
        JSON.stringify(draft) !== JSON.stringify(actionDraft())) throw Error('Wallet or action changed during review.');
      state.actionPlan = { input: draft, result: plan };
      text('action-details', `${draft.action} · ${draft.market} · ${draft.action === 'CANCEL' ?
        `order #${draft.orderId}` : `${draft.amount} USDso`} · allowance ${plan.allowance} USDso · wallet ${plan.walletUsdso} USDso · withdrawable ${plan.withdrawable} USDso`);
      text('action-contract', `Hideki 50383 · ${plan.transaction.to} · from ${plan.transaction.from} · selector ${plan.transaction.data.slice(0, 10)} · max simulated gas ${plan.transaction.maxGasCostStt} STT`);
      $('action-review').hidden = false; $('confirm-action').disabled = false;
      actionStatus('Review the exact action, then confirm explicitly in your wallet.', 'ok');
    } catch (error) { actionStatus(`Action blocked: ${error.message}`, 'error'); invalidateAction(); }
    finally { state.busy = false; $('review-action').disabled = !connected() || !!state.pendingHash || !!state.actionPending; }
  };
  $('dismiss-action').onclick = () => { invalidateAction(); actionStatus('Wallet action review closed.'); };
  $('confirm-action').onclick = async () => {
    if (!state.actionPlan || state.busy || !connected() || state.pendingHash || state.actionPending) return;
    const reviewed = state.actionPlan;
    state.busy = true; $('confirm-action').disabled = true; $('review-action').disabled = true;
    actionStatus('Rechecking balance, allowance, order status and simulation…', 'warn');
    try {
      const chain = Number(await state.provider.request({ method: 'eth_chainId' }));
      const accounts = await state.provider.request({ method: 'eth_accounts' });
      if (chain !== 50383 || !accounts.some(value => value.toLowerCase() === reviewed.input.account.toLowerCase()))
        throw Error('Wallet account or network changed.');
      const fresh = await request('/api/v1/trade/action/prepare', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(reviewed.input) });
      const tx = fresh.transaction, prior = reviewed.result.transaction;
      if (!connected() || JSON.stringify(reviewed.input) !== JSON.stringify(actionDraft()) ||
        tx.chainId !== 50383 || tx.value !== '0x0' || tx.from.toLowerCase() !== prior.from.toLowerCase() ||
        tx.to.toLowerCase() !== prior.to.toLowerCase() || tx.data !== prior.data || tx.gas !== prior.gas)
        throw Error('Fresh action preflight differs. Review again.');
      actionStatus('Waiting for explicit wallet approval…', 'warn');
      const hash = await state.provider.request({ method: 'eth_sendTransaction', params: [{
        from: tx.from, to: tx.to, data: tx.data, value: tx.value, gas: tx.gas }] });
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw Error('Wallet returned an invalid transaction hash.');
      state.actionPlan = null; $('action-review').hidden = true;
      state.actionPending = { hash, ...reviewed.input }; invalidate();
      recordJournal(hash, { account: reviewed.input.account, market: reviewed.input.market,
        action: reviewed.input.action, orderId: reviewed.input.orderId || null, state: 'SUBMITTED' });
      actionStatus(`Submitted ${hash}. Reading independent receipt…`, 'warn');
      for (let attempt = 0; attempt < 12; attempt++) {
        const receipt = await request(`/api/v1/trade/action/receipt?hash=${encodeURIComponent(hash)}&account=${encodeURIComponent(reviewed.input.account)}&market=${encodeURIComponent(reviewed.input.market)}&action=${reviewed.input.action}&orderId=${encodeURIComponent(reviewed.input.orderId)}&amount=${encodeURIComponent(reviewed.input.amount)}`);
        if (receipt.state !== 'PENDING') { state.actionPending = null;
          recordJournal(hash, { state: receipt.state === 'CONFIRMED' ?
            reviewed.input.action === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED' : receipt.state,
          source: `HIDEKI_RECEIPT_BLOCK_${receipt.block ?? 'UNKNOWN'}` });
          actionStatus(`${reviewed.input.action} ${receipt.state} at block ${receipt.block ?? 'UNKNOWN'}${receipt.reason ? `: ${receipt.reason}` : ''}. Account read follows.`,
            receipt.state === 'CONFIRMED' ? 'ok' : 'error');
          await loadAccount(); invalidateAction(); return; }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      actionStatus(`${reviewed.input.action} ${hash} remains pending. Use Refresh to check receipt.`, 'warn');
    } catch (error) { actionStatus(`Wallet action stopped: ${error.message}`, 'error'); invalidateAction(); }
    finally { state.busy = false; $('review-action').disabled = !connected() || !!state.pendingHash || !!state.actionPending;
      $('review-order').disabled = !connected() || !!state.pendingHash || !!state.actionPending; }
  };
  $('refresh').addEventListener('click', async () => {
    if (connected()) loadAccount();
    if (state.actionPending) {
      const pending = state.actionPending;
      try { const receipt = await request(`/api/v1/trade/action/receipt?hash=${encodeURIComponent(pending.hash)}&account=${encodeURIComponent(pending.account)}&market=${encodeURIComponent(pending.market)}&action=${pending.action}&orderId=${encodeURIComponent(pending.orderId)}&amount=${encodeURIComponent(pending.amount)}`);
        if (receipt.state === 'PENDING') actionStatus(`${pending.action} ${pending.hash} is still pending.`, 'warn');
        else { state.actionPending = null;
          recordJournal(pending.hash, { state: receipt.state === 'CONFIRMED' ?
            pending.action === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED' : receipt.state,
          source: `HIDEKI_RECEIPT_BLOCK_${receipt.block ?? 'UNKNOWN'}` });
          actionStatus(`${pending.action} ${receipt.state} at block ${receipt.block ?? 'UNKNOWN'}.`,
            receipt.state === 'CONFIRMED' ? 'ok' : 'error'); invalidateAction(); }
      } catch (error) { actionStatus(`Action receipt read unavailable: ${error.message}`, 'error'); }
    }
    if (state.pendingHash && state.pendingAccount) {
      try { const receipt = await request(`/api/v1/trade/receipt?hash=${encodeURIComponent(state.pendingHash)}&account=${encodeURIComponent(state.pendingAccount)}&market=${encodeURIComponent(state.pendingMarket)}`);
        if (receipt.state === 'PENDING') status(`Transaction ${state.pendingHash} is still pending.`, 'warn');
        else { recordJournal(state.pendingHash, { state: receipt.state === 'PLACED' ? 'CONFIRMED' : receipt.state,
          orderId: receipt.orderId ?? null, outcomeAtPlacement: receipt.outcomeAtPlacement ?? null,
          source: `HIDEKI_RECEIPT_BLOCK_${receipt.block ?? 'UNKNOWN'}` });
          status(receipt.state === 'PLACED' ?
          `On-chain placement confirmed: order #${receipt.orderId}, block ${receipt.block}.` :
          `Transaction ${receipt.state}: ${receipt.reason ?? `block ${receipt.block}`}`,
        receipt.state === 'PLACED' ? 'ok' : 'error'); state.pendingHash = null; state.pendingAccount = null;
          state.pendingMarket = null;
          $('review-order').disabled = !connected(); }
      } catch (error) { status(`Receipt read unavailable: ${error.message}`, 'error'); }
    }
  });
  $('review-order').onclick = async () => {
    if (!connected() || state.busy || state.pendingHash || state.actionPending) return;
    state.plan = null; $('trade-review').hidden = true; $('confirm-wallet').disabled = true;
    state.busy = true; $('review-order').disabled = true; status('Running Canary Trade Guard and contract simulation…');
    const draft = input();
    try {
      const plan = await request('/api/v1/trade/prepare', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft) });
      if (!connected() || draft.account.toLowerCase() !== state.account.toLowerCase() ||
        draft.market !== $('market-select').value ||
        draft.side !== state.side || draft.price !== $('limit-price').value.trim() ||
        draft.quantity !== $('quantity').value.trim()) throw Error('Wallet or order changed during review. Start again.');
      text('guard-verdict', plan.guard.verdict);
      $('guard-verdict').dataset.verdict = plan.guard.verdict;
      text('guard-explanation', [...plan.guard.blockers, ...plan.guard.warnings].join(' ') ||
        'Trusted book, price grid, margin size, gas budget and contract simulation passed.');
      if (plan.status !== 'READY' || !plan.transaction) { status('Order blocked by Canary Trade Guard.', 'error'); return; }
      state.plan = { input: draft, result: plan };
      text('review-details', `${draft.side} ${draft.quantity} ${draft.market} @ ${draft.price} USDso · PostOnly · estimated notional ${
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
      state.pendingHash = hash; state.pendingAccount = tx.from; state.pendingMarket = reviewed.input.market;
      state.plan = null; $('trade-review').hidden = true;
      recordJournal(hash, { account: tx.from, market: reviewed.input.market, action: 'PLACE',
        side: reviewed.input.side, quantity: reviewed.input.quantity, price: reviewed.input.price,
        state: 'SUBMITTED' });
      status(`Submitted ${hash}. Waiting for an independently read receipt…`, 'warn');
      for (let attempt = 0; attempt < 12; attempt++) {
        const receipt = await request(`/api/v1/trade/receipt?hash=${encodeURIComponent(hash)}&account=${encodeURIComponent(tx.from)}&market=${encodeURIComponent(reviewed.input.market)}`);
        if (receipt.state !== 'PENDING') { state.pendingHash = null; state.pendingAccount = null;
          state.pendingMarket = null;
          recordJournal(hash, { state: receipt.state === 'PLACED' ? 'CONFIRMED' : receipt.state,
            orderId: receipt.orderId ?? null, outcomeAtPlacement: receipt.outcomeAtPlacement ?? null,
            source: `HIDEKI_RECEIPT_BLOCK_${receipt.block ?? 'UNKNOWN'}` });
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
  displayAccount(); loadMarkets();
})();

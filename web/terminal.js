(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const set = (id, value) => { $(id).textContent = value == null || value === '' ? '—' : String(value); };
  const state = { market: null, proof: null, history: null, plan: null, tradeCommand: null, side: 'BUY',
    observations: [], started: new Date(), marketBusy: false, historyBusy: false, marketFailures: 0 };
  let marketRetryTimer = null;
  const archiveButton = document.createElement('button');
  archiveButton.id = 'historical-tools'; archiveButton.type = 'button';
  archiveButton.className = 'button secondary'; archiveButton.textContent = 'Show historical owner evidence';
  archiveButton.setAttribute('aria-expanded', 'false');
  document.querySelector('.head-actions').append(archiveButton);
  const publicMode = document.body.dataset.publicMode === 'true';
  if (publicMode) {
    archiveButton.hidden = true;
    document.querySelectorAll('a[href="/legacy"]').forEach(link => { link.hidden = true; });
  }
  const historical = [document.getElementById('risk'), document.getElementById('portfolio'),
    document.getElementById('proof'), document.querySelector('.prepare-command'),
    document.getElementById('copy-prepare'), document.getElementById('copy-feedback')];
  historical.forEach(element => { element.hidden = true; });
  archiveButton.onclick = () => {
    const show = archiveButton.getAttribute('aria-expanded') !== 'true';
    archiveButton.setAttribute('aria-expanded', String(show));
    archiveButton.textContent = show ? 'Hide historical owner evidence' : 'Show historical owner evidence';
    historical.forEach(element => { element.hidden = !show; });
    if (show) { loadOwnerAccount(); loadHistory(); loadPlan(); }
  };
  const money = value => {
    const number = Number(value);
    if (value == null || !Number.isFinite(number)) return '—';
    const places = number >= 1 ? 2 : number >= .01 ? 4 : 8;
    return number.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places });
  };
  function decimalRaw(value, decimals) {
    if (typeof value !== 'string' || !/^\d{1,24}(?:\.\d+)?$/.test(value)) throw Error('Enter a positive decimal number.');
    const [whole, fraction = ''] = value.split('.');
    if (fraction.length > decimals) throw Error(`Use at most ${decimals} decimal places.`);
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  }
  function rawDecimal(raw, decimals) {
    const scale = 10n ** BigInt(decimals);
    const fraction = (raw % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${raw / scale}${fraction ? `.${fraction}` : ''}`;
  }
  function offsetPrice(bid, tick, bps) {
    const target = bid * (10000n - BigInt(bps)) / 10000n;
    return rawDecimal(target / tick * tick, 18);
  }
  async function read(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!(response.headers.get('content-type') || '').includes('application/json'))
      throw Error(`Non-JSON response (HTTP ${response.status})`);
    const value = await response.json();
    if (!response.ok) throw Error(value.error || `HTTP ${response.status}`);
    return value;
  }
  function trustedBook() {
    const book = state.market?.book;
    return book?.status === 'TRUSTED' && !!book.observedAt &&
      Date.now() >= Date.parse(book.observedAt) && Date.now() - Date.parse(book.observedAt) <= 30000;
  }
  function drawChart() {
    const points = state.observations;
    set('chart-count', `${points.length} observed quote${points.length === 1 ? '' : 's'}`);
    set('chart-start', `Collection started ${state.started.toLocaleTimeString()}`);
    $('chart-empty').hidden = points.length >= 8;
    if (points.length > 0 && points.length < 8)
      set('chart-empty', `${points.length} live mark update${points.length === 1 ? '' : 's'} collected. A trace appears after 8 distinct blocks; no historical candles are implied.`);
    if (!points.length) return;
    const prices = points.map(p => p.price);
    const low = Math.min(...prices), high = Math.max(...prices);
    const pad = Math.max((high - low) * .25, high * .00025, .01);
    const span = high - low + pad * 2;
    const x = i => 50 + (points.length === 1 ? 315 : i * 630 / (points.length - 1));
    const y = price => 235 - (price - low + pad) / span * 180;
    $('chart-line').setAttribute('d', points.length >= 8 ? points.map((p, i) =>
      `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.price).toFixed(1)}`).join(' ') : '');
    const dot = $('chart-dot'), last = points.at(-1);
    dot.hidden = false; dot.setAttribute('cx', x(points.length - 1)); dot.setAttribute('cy', y(last.price));
    set('chart-y-high', money(high + pad)); set('chart-y-low', money(low - pad));
    set('chart-x-start', new Date(points[0].time).toLocaleTimeString());
    set('chart-x-end', new Date(last.time).toLocaleTimeString());
    set('chart-last', `LATEST ${money(last.price)} USDso · block ${last.block}`);
    $('chart').setAttribute('aria-label', `${points.length} real observed ${$('market-select').value} mark quotes since ${state.started.toLocaleTimeString()}; latest ${money(last.price)} USDso`);
  }
  function updateRisk() {
    const m = state.market;
    const bookState = !m ? 'UNKNOWN' : m.book.status !== 'TRUSTED' ? 'BLOCKED' : trustedBook() ? 'PASS' : 'STALE';
    const gates = [
      ['Trusted book', bookState],
      ['BTC-PERP market', m?.risk?.market ?? 'UNKNOWN'],
      ['Margin', m?.margin?.status ?? 'NOT_RUN'],
      ['Place grant', m?.bot?.placeGrant ?? 'UNKNOWN'],
      ['Nonce', 'NOT_RUN'],
      ['Gas balance', m?.risk?.gas ?? 'UNKNOWN'],
      ['Expiry', 'NOT_RUN'],
      ['Mark deviation', 'NOT_RUN'],
      ['Simulation', 'NOT_RUN'],
    ];
    $('gate-grid').replaceChildren(...gates.map(([name, status]) => {
      const div = document.createElement('div'); div.className = 'gate';
      const label = document.createElement('span'); label.textContent = name;
      const value = document.createElement('strong'); value.textContent = status;
      value.className = status === 'PASS' || status === 'SUPPORTED' || status === 'SUFFICIENT' ? 'ok' :
        status === 'BLOCKED' || status === 'INSUFFICIENT' ? 'fail' : 'pending';
      div.append(label, value); return div;
    }));
    const blocked = gates.some(([, status]) => status === 'BLOCKED' || status === 'INSUFFICIENT');
    $('risk-badge').className = `badge ${blocked ? 'red' : 'amber'}`;
    set('risk-badge', blocked ? 'RED · BLOCKED' : bookState === 'STALE' ? 'AMBER · STALE' :
      !m ? 'AMBER · UNKNOWN' : 'AMBER · CLI PREFLIGHT REQUIRED');
    set('risk-explanation', 'This dashboard never signs. Nonce, margin preview, gas estimate, expiry, mark deviation and simulation require a fresh exact CLI plan. NOT_RUN is not FAILED.');
    set('risk-reasons', m?.book?.reasons?.length ? m.book.reasons.join(' · ') :
      bookState === 'STALE' ? 'Market snapshot aged out. Refresh before planning.' :
        m?.bot?.placeGrant === 'SUPPORTED' && bookState === 'PASS' ?
          'Market observation is trusted. A specific order still requires full local CLI preflight.' :
          'Market or grant is unavailable. Refresh read-only data before planning.');
  }
  function updatePreview() {
    const m = state.market, priceText = $('limit-price').value.trim(), quantityText = $('quantity').value.trim();
    state.tradeCommand = null;
    $('copy-prepare').disabled = true;
    $('trade-error').className = 'trade-error';
    set('gas-estimate', 'NOT_RUN'); set('margin-preview', 'NOT_RUN');
    set('notional', '—'); set('prepare-command', 'A fresh trusted quote and valid BUY PostOnly values are required.');
    $('quantity').removeAttribute('aria-invalid'); $('limit-price').removeAttribute('aria-invalid');
    if (!priceText && !quantityText) { set('trade-error', 'Enter quantity and a BUY limit price.'); return; }
    let price, quantity;
    try { price = decimalRaw(priceText, 18); }
    catch (error) { $('limit-price').setAttribute('aria-invalid', 'true'); set('trade-error', `Limit price: ${error.message}`); return; }
    try { quantity = decimalRaw(quantityText, m?.grid?.baseDecimals ?? 8); }
    catch (error) { $('quantity').setAttribute('aria-invalid', 'true'); set('trade-error', `Quantity: ${error.message}`); return; }
    if (price <= 0n || quantity <= 0n) { set('trade-error', 'Price and quantity must be greater than zero.'); return; }
    const notional = price * quantity / 10n ** BigInt(m?.grid?.baseDecimals ?? 8);
    set('notional', `${money(rawDecimal(notional, 18))} USDso`);
    if (!trustedBook() || m?.chainId !== 50383 || m?.market !== $('market-select').value || m?.risk?.market !== 'SUPPORTED') {
      set('trade-error', 'A fresh TRUSTED quote for the selected market is required. Refresh the market.'); return;
    }
    try {
      const tick = BigInt(m.grid.tickSizeRaw), lot = BigInt(m.grid.lotSizeRaw);
      const min = BigInt(m.grid.minQuantityRaw), ask = decimalRaw(m.book.ask, 18);
      const mark = decimalRaw(m.mark, 18);
      if (tick <= 0n || price % tick !== 0n) throw Error('Limit price must be on the market tick grid.');
      if (lot <= 0n || quantity < min || quantity % lot !== 0n)
        throw Error(`Quantity must be at least ${rawDecimal(min, m.grid.baseDecimals ?? 8)} ${m.marketMeta?.base ?? 'BTC'} and on the lot grid.`);
      if (state.side === 'BUY' ? price >= ask : price <= decimalRaw(m.book.bid, 18))
        throw Error(`${state.side} PostOnly would cross the opposite book top.`);
      const deviation = price > mark ? price - mark : mark - price;
      if (mark <= 0n || deviation * 10000n > mark * 100n) throw Error('Limit is more than 1% from mark.');
      if (notional > 100n * 10n ** 18n) throw Error('Notional exceeds the 100 USDso limit.');
      if (notional <= 0n) throw Error('Notional must be positive.');
    } catch (error) { set('trade-error', error.message); return; }
    const normalizedPrice = rawDecimal(price, 18), normalizedQuantity = rawDecimal(quantity, m.grid.baseDecimals ?? 8);
    state.tradeCommand = state.side === 'BUY' && m.market === 'BTC-PERP' && m.bot.placeGrant === 'SUPPORTED' ?
      `npm.cmd run canary-prepare -- BUY ${normalizedPrice} ${normalizedQuantity}` : null;
    set('prepare-command', state.tradeCommand ?? 'Owner CLI supports BTC BUY only. Use the connected wallet review for this market.');
    $('trade-error').className = 'trade-error okay';
    set('trade-error', 'Input preview only. Wallet review runs fresh Canary Trade Guard checks.');
    $('copy-prepare').disabled = !state.tradeCommand;
  }
  function updateBookFreshness() {
    if (trustedBook()) return;
    const stale = state.market?.book?.status === 'TRUSTED';
    set('best-bid', '—'); set('best-ask', '—'); set('spread', '—');
    set('book-bid', '—'); set('book-ask', '—'); set('book-spread', '—');
    set('book-status', `BOOK · ${stale ? 'STALE' : state.market ? 'UNTRUSTED' : 'UNKNOWN'}`);
    set('market-age', stale ? 'Book snapshot stale' : 'Book unavailable');
    $('book-badge').className = `badge ${stale ? 'amber' : 'red'}`; set('book-badge', stale ? 'STALE' : 'UNTRUSTED');
    if (stale) { set('rpc-pill', 'RPC · STALE SNAPSHOT'); $('rpc-pill').className = 'pill muted'; }
    $('depth-asks').replaceChildren(); $('depth-bids').replaceChildren();
    $('use-bid').disabled = true; $('use-ask').disabled = true;
    document.querySelectorAll('[data-offset]').forEach(button => { button.disabled = true; });
    updatePreview();
  }
  function renderMarket(m) {
    state.market = m;
    const fresh = trustedBook();
    set('rpc-pill', `RPC · LIVE #${m.block}`); $('rpc-pill').className = 'pill good';
    set('bot-pill', `POOL · ${m.risk?.market === 'SUPPORTED' ? 'TRADEABLE' : 'UNVERIFIED'}`);
    $('bot-pill').className = `pill ${m.risk?.market === 'SUPPORTED' ? 'good' : 'muted'}`;
    document.querySelector('.chart-panel h2').textContent = `${m.market} price trace`;
    document.querySelector('.book-labels span:last-child').textContent = `QTY (${m.marketMeta?.base ?? 'BTC'})`;
    document.querySelector('.summary-grid .metric span').textContent = `USDso / ${m.marketMeta?.base ?? 'BTC'}`;
    document.querySelector('.trade-panel .field span').textContent = m.marketMeta?.base ?? 'BTC';
    set('mark', m.mark == null ? '—' : money(m.mark));
    set('best-bid', fresh ? money(m.book.bid) : '—'); set('best-ask', fresh ? money(m.book.ask) : '—');
    const spread = fresh && m.book.bid && m.book.ask ? Number(m.book.ask) - Number(m.book.bid) : null;
    set('spread', spread == null ? '—' : spread.toFixed(2));
    set('market-block', m.block); set('market-age', fresh ? `Observed ${new Date(m.book.observedAt).toLocaleTimeString()}` : 'Book unavailable or stale');
    set('book-status', `BOOK · ${fresh ? 'TRUSTED' : 'UNTRUSTED'}`);
    set('book-bid', fresh ? money(m.book.bid) : '—'); set('book-ask', fresh ? money(m.book.ask) : '—');
    set('book-spread', spread == null ? '—' : spread.toFixed(2));
    set('book-time', m.book.observedAt ? new Date(m.book.observedAt).toLocaleTimeString() : '—');
    set('book-block', m.book.block); set('book-reasons', m.book.reasons.length ? m.book.reasons.join(' · ') : 'SDK on-chain and direct RPC top of book agree.');
    $('book-badge').className = `badge ${fresh ? 'green' : 'red'}`; set('book-badge', fresh ? 'TRUSTED' : 'UNTRUSTED');
    const depthRow = (side, level) => {
      const div = document.createElement('div'); div.className = `depth-row ${side}`;
      for (const text of [side.toUpperCase(), money(level.price), level.quantity]) {
        const cell = document.createElement('span'); cell.textContent = text; div.append(cell);
      } return div;
    };
    $('depth-asks').replaceChildren(...(fresh && m.depth?.status === 'VERIFIED' ?
      m.depth.asks.slice(1).reverse().map(level => depthRow('ask', level)) : []));
    $('depth-bids').replaceChildren(...(fresh && m.depth?.status === 'VERIFIED' ?
      m.depth.bids.slice(1).map(level => depthRow('bid', level)) : []));
    if (fresh && m.depth?.status !== 'VERIFIED') set('book-reasons', `Trusted top only; deeper levels unavailable: ${m.depth?.reason || 'UNKNOWN'}`);
    $('use-bid').disabled = !fresh || state.side !== 'BUY'; $('use-ask').disabled = !fresh || state.side !== 'SELL';
    document.querySelectorAll('[data-offset]').forEach(button => { button.disabled = !fresh; });
    const markTime = Date.parse(m.observedAt);
    const credibleMark = fresh && m.chainId === 50383 && m.market === $('market-select').value &&
      m.mark != null && Number.isFinite(Number(m.mark)) && Number(m.mark) > 0 &&
      Number.isFinite(markTime) && Date.now() >= markTime && Date.now() - markTime <= 30000;
    if (credibleMark && state.observations.at(-1)?.block !== m.block) {
      state.observations.push({ time: markTime, price: Number(m.mark), block: m.block });
      if (state.observations.length > 90) state.observations.shift();
      drawChart();
    }
    set('chart-source', credibleMark ? `LIVE trusted mark observation at block ${m.block}` :
      `Mark not charted: ${!fresh ? 'book stale or untrusted' : 'mark observation stale or unavailable'}.`);
    updateBookFreshness();
    updateRisk(); updatePreview();
    window.dispatchEvent(new window.CustomEvent('canary:market', { detail: m }));
  }
  function timelineItem(name, detail) {
    const li = document.createElement('li'), strong = document.createElement('strong'), span = document.createElement('span');
    strong.textContent = name; span.textContent = detail; li.append(strong, span); return li;
  }
  function renderOwnerAccount(h) {
    set('position-size', h.position.sizeBtc); set('entry-price', money(h.position.entryPrice));
    set('position-block', `BLOCK ${h.position.block}`); set('open-count', h.openOrders.length);
    const body = $('orders-body'); body.replaceChildren();
    if (!h.openOrders.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 5; td.textContent = `No open BTC-PERP orders at block ${h.readBlock}`; tr.append(td); body.append(tr); }
    for (const row of h.openOrders) {
      const tr = document.createElement('tr'); tr.className = 'order-row';
      const labels = ['Order ID', 'Side', 'Limit', 'Remaining', 'Status'];
      for (const [index, value] of [row.id, row.side, money(row.price), row.remaining, 'OPEN_AT_READ'].entries()) {
        const td = document.createElement('td'); td.textContent = value; td.dataset.label = labels[index]; tr.append(td);
      } body.append(tr);
    }
  }
  function renderHistory(h) {
    state.history = h;
    renderOwnerAccount(h);
    set('order-state', h.lifecycle.state); set('order-cause', h.lifecycle.cause);
    const items = h.events.map(e => timelineItem(e.name, `Block ${e.block} · tx ${e.txHash.slice(0, 12)}… · ${e.source}${e.quantityRaw ? ` · ${Number(e.quantityRaw) / 1e8} BTC` : ''}`));
    items.push(timelineItem(h.lifecycle.state, `Open-order and position read at block ${h.readBlock}; events scanned through ${h.scanThroughBlock}. Cause: ${h.lifecycle.cause}.`));
    $('timeline').replaceChildren(...items);
  }
  function renderProof(p) {
    state.proof = p;
    $('proof-lead').hidden = false;
    $('proof-badge').className = 'badge green'; set('proof-badge', 'VERIFIED');
    set('proof-events', `Verified receipt events: OrderPlaced + OrderRested at block ${p.block}. Independent chain read at proof creation.`);
    document.querySelectorAll('[data-copy]').forEach(button => { button.disabled = false; });
    for (const [id, value] of [['tx-hash', p.txHash], ['order-id', p.orderId], ['plan-hash', p.planHash],
      ['proof-hash', p.proofHash], ['receipt-block', p.block], ['gas-used', `${p.gasUsed} units`]]) set(id, value);
  }
  async function copy(value, label, feedback = 'copy-feedback') {
    if (!value) return;
    try { await window.navigator.clipboard.writeText(value); set(feedback, `${label}: Copied`);
      $(feedback).className = 'small live-message copy-success'; }
    catch { set(feedback, 'Copy failed. Use the displayed value or local CLI output.');
      $(feedback).className = 'small live-message copy-failure'; }
  }
  async function loadPlan() {
    try {
      const plan = await read('/api/v1/terminal/plan'); state.plan = plan;
      const active = plan && Date.now() < Date.parse(plan.expiresAt);
      $('copy-active-plan').disabled = !active; $('copy-execute').disabled = !active; $('copy-confirmation').disabled = !active;
      set('plan-state', active ? `Active saved plan ${plan.hash}. Expires ${new Date(plan.expiresAt).toLocaleTimeString()}; CLI rechecks all gates.` :
        'No unexpired saved plan. Create a fresh one in the owner CLI. The verified first plan has expired.');
    } catch (error) { state.plan = null;
      $('copy-active-plan').disabled = true; $('copy-execute').disabled = true; $('copy-confirmation').disabled = true;
      set('plan-state', `Plan lookup unavailable: ${error.message}`); }
  }
  async function loadMarket() {
    if (state.marketBusy) return; state.marketBusy = true; $('refresh').disabled = true;
    if (marketRetryTimer) { window.clearTimeout(marketRetryTimer); marketRetryTimer = null; }
    set('refresh', 'Refreshing live data...');
    const selected = $('market-select').value;
    try { const market = await read(`/api/v1/markets/snapshot?market=${encodeURIComponent(selected)}`);
      if ($('market-select').value === selected) { state.marketFailures = 0; renderMarket(market); } }
    catch (error) { if ($('market-select').value !== selected) return;
      state.marketFailures++;
      set('rpc-pill', 'RPC · UNKNOWN'); $('rpc-pill').className = 'pill bad';
      set('bot-pill', 'POOL · UNKNOWN'); $('bot-pill').className = 'pill muted';
      state.market = null; set('mark', '—'); set('market-block', 'UNKNOWN');
      set('book-reasons', error.message); set('chart-source', `Source error: ${error.message}`);
      if (!state.observations.length) set('chart-empty', `Live source unavailable: ${error.message}`);
      updateBookFreshness(); updateRisk();
      window.dispatchEvent(new window.CustomEvent('canary:market', { detail: null })); }
    finally { state.marketBusy = false; $('refresh').disabled = false; set('refresh', 'Refresh live data');
      if ($('market-select').value !== selected) window.setTimeout(loadMarket, 0);
      else if (state.marketFailures > 0 && state.marketFailures <= 3)
        marketRetryTimer = window.setTimeout(() => { if ($('market-select').value === selected) loadMarket(); },
          [3000, 8000, 20000][state.marketFailures - 1]); }
  }
  async function loadHistory() {
    if (state.historyBusy) return; state.historyBusy = true;
    set('position-block', 'REFRESHING...');
    try { renderHistory(await read('/api/v1/terminal/history')); }
    catch (error) { $('timeline').replaceChildren(timelineItem('UNKNOWN', `Read-only RPC history unavailable: ${error.message}`));
      set('order-state', 'UNKNOWN'); set('order-cause', 'UNKNOWN');
      if (!state.ownerAccount) {
        set('position-size', 'UNKNOWN'); set('entry-price', 'UNKNOWN'); set('open-count', 'UNKNOWN');
        set('position-block', 'BLOCK UNKNOWN'); $('orders-body').replaceChildren(); } }
    finally { state.historyBusy = false; }
  }
  async function loadOwnerAccount() {
    try { const account = await read('/api/v1/terminal/account');
      state.ownerAccount = account; if (!state.history || BigInt(account.readBlock) >= BigInt(state.history.readBlock))
        renderOwnerAccount(account);
    } catch { if (!state.history) set('position-block', 'BLOCK UNKNOWN'); }
  }
  $('refresh').onclick = () => { loadMarket();
    if (archiveButton.getAttribute('aria-expanded') === 'true') { loadOwnerAccount(); loadHistory(); loadPlan(); } };
  $('market-select').addEventListener('change', () => {
    state.market = null; state.marketFailures = 0; state.observations = []; state.started = new Date();
    $('chart-line').setAttribute('d', ''); $('chart-dot').hidden = true;
    set('chart-count', '0 observed quotes'); set('chart-empty', 'Waiting for verified live observations.');
    $('chart-empty').hidden = false; $('quantity').value = ''; $('limit-price').value = '';
    for (const id of ['mark', 'best-bid', 'best-ask', 'spread', 'book-bid', 'book-ask', 'book-spread']) set(id, '—');
    set('market-block', 'LOADING'); set('book-block', 'LOADING'); set('book-time', '—');
    set('book-reasons', `Loading ${$('market-select').value} book and verifying its pool…`);
    $('depth-asks').replaceChildren(); $('depth-bids').replaceChildren();
    window.dispatchEvent(new window.CustomEvent('canary:market', { detail: null }));
    updateBookFreshness(); loadMarket();
  });
  function selectSide(side) {
    state.side = side;
    $('buy').classList.toggle('selected', side === 'BUY'); $('sell').classList.toggle('selected', side === 'SELL');
    $('buy').setAttribute('aria-pressed', String(side === 'BUY'));
    $('sell').setAttribute('aria-pressed', String(side === 'SELL'));
    $('use-bid').disabled = !trustedBook() || side !== 'BUY';
    $('use-ask').disabled = !trustedBook() || side !== 'SELL';
    document.querySelector('.offset-label').textContent = `${side} OFFSET FROM BEST ${side === 'BUY' ? 'BID' : 'ASK'}`;
    document.querySelectorAll('[data-offset]').forEach(button => {
      button.textContent = `${side === 'BUY' ? '−' : '+'}${button.dataset.offset} bps`;
    });
    updatePreview(); window.dispatchEvent(new window.CustomEvent('canary:side', { detail: side }));
  }
  $('buy').onclick = () => { selectSide('BUY'); $('quantity').focus(); };
  $('sell').disabled = false;
  $('sell').onclick = () => { selectSide('SELL'); $('quantity').focus(); };
  $('quantity').oninput = updatePreview; $('limit-price').oninput = updatePreview;
  $('use-bid').onclick = () => { if (trustedBook()) { $('limit-price').value = state.market.book.bid; updatePreview(); } };
  $('use-ask').onclick = () => { if (trustedBook() && state.side === 'SELL') {
    $('limit-price').value = state.market.book.ask; updatePreview(); } };
  document.querySelectorAll('[data-offset]').forEach(button => { button.onclick = () => {
    if (!trustedBook()) return;
    let top, tick;
    try { top = decimalRaw(state.side === 'BUY' ? state.market.book.bid : state.market.book.ask, 18);
      tick = BigInt(state.market.grid.tickSizeRaw); }
    catch { set('trade-error', 'Trusted price grid is unavailable. Refresh the market.'); return; }
    if (tick <= 0n) { set('trade-error', 'Market tick size is unavailable.'); return; }
    $('limit-price').value = state.side === 'BUY' ? offsetPrice(top, tick, Number(button.dataset.offset)) :
      rawDecimal(((top * (10000n + BigInt(button.dataset.offset)) + 9999n) / 10000n + tick - 1n) / tick * tick, 18);
    updatePreview();
  }; });
  $('copy-prepare').onclick = () => { updatePreview(); if (state.tradeCommand) copy(state.tradeCommand, 'Owner prepare command'); };
  document.querySelectorAll('[data-copy]').forEach(button => { button.disabled = true; button.onclick = () => {
    const p = state.proof; if (!p) return;
    const key = button.dataset.copy;
    copy(key === 'tx' ? p.txHash : key === 'plan' ? p.planHash : p.proofHash, `${key} hash`, 'proof-copy-feedback');
  }; });
  $('copy-execute').onclick = () => { if (state.plan && Date.now() < Date.parse(state.plan.expiresAt))
    copy(`npm.cmd run bot-execute -- execute ${state.plan.hash}`, 'Execute command', 'proof-copy-feedback'); };
  $('copy-active-plan').onclick = () => { if (state.plan && Date.now() < Date.parse(state.plan.expiresAt))
    copy(state.plan.hash, 'Active plan hash', 'proof-copy-feedback'); };
  $('copy-confirmation').onclick = () => { if (state.plan && Date.now() < Date.parse(state.plan.expiresAt))
    copy(`EXECUTE ${state.plan.hash}`, 'Exact confirmation', 'proof-copy-feedback'); };
  updateRisk(); drawChart();
  if (!publicMode) read('/api/v1/terminal/proof').then(renderProof).catch(error => {
    $('proof-badge').className = 'badge red'; set('proof-badge', 'UNKNOWN');
    set('proof-events', 'Receipt events unavailable for verification.');
    set('proof-hash', `UNKNOWN: ${error.message}`);
  });
  loadMarket();
  window.setInterval(loadMarket, 30000);
  window.setInterval(() => { if (archiveButton.getAttribute('aria-expanded') === 'true') loadHistory(); }, 60000);
  window.setInterval(() => { if (archiveButton.getAttribute('aria-expanded') === 'true') loadPlan(); }, 10000);
  window.setInterval(() => { if (state.market) { updateBookFreshness(); updateRisk(); }
    if (state.plan && Date.now() >= Date.parse(state.plan.expiresAt)) loadPlan(); }, 5000);
})();

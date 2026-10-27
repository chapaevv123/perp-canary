(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const set = (id, value) => { $(id).textContent = value == null || value === '' ? '—' : String(value); };
  const state = { market: null, proof: null, history: null, plan: null,
    observations: [], started: new Date(), marketBusy: false, historyBusy: false };
  const money = value => value == null || !Number.isFinite(Number(value)) ? '—' :
    Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    $('chart-empty').hidden = points.length > 0;
    if (!points.length) return;
    const prices = points.map(p => p.price);
    const low = Math.min(...prices), high = Math.max(...prices);
    const pad = Math.max((high - low) * .25, high * .00025);
    const span = high - low + pad * 2;
    const x = i => 50 + (points.length === 1 ? 315 : i * 630 / (points.length - 1));
    const y = price => 235 - (price - low + pad) / span * 180;
    $('chart-line').setAttribute('d', points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.price).toFixed(1)}`).join(' '));
    const dot = $('chart-dot'), last = points.at(-1);
    dot.hidden = false; dot.setAttribute('cx', x(points.length - 1)); dot.setAttribute('cy', y(last.price));
    $('chart').setAttribute('aria-label', `${points.length} real observed BTC-PERP mark quotes since ${state.started.toLocaleTimeString()}; latest ${money(last.price)} USDso`);
  }
  function updateRisk() {
    const m = state.market;
    const gates = [
      ['Trusted book', trustedBook() ? 'PASS' : 'BLOCKED'],
      ['Margin', m?.margin?.status ?? 'NOT_RUN'],
      ['Place grant', m?.bot?.placeGrant ?? 'NOT_RUN'],
      ['Nonce', 'NOT_RUN'],
      ['Gas', m?.risk?.gas ?? 'NOT_RUN'],
      ['Expiry', 'NOT_RUN'],
      ['Mark deviation', 'NOT_RUN'],
      ['Simulation', 'NOT_RUN'],
    ];
    $('gate-grid').replaceChildren(...gates.map(([name, status]) => {
      const div = document.createElement('div'); div.className = 'gate';
      const label = document.createElement('span'); label.textContent = name;
      const value = document.createElement('strong'); value.textContent = status;
      value.className = status === 'PASS' || status === 'SUPPORTED' || status === 'BALANCE_OBSERVED' || status === 'SUFFICIENT' ? 'ok' :
        status === 'BLOCKED' || status === 'INSUFFICIENT' ? 'fail' : 'pending';
      div.append(label, value); return div;
    }));
    const ready = trustedBook() && m?.bot?.placeGrant === 'SUPPORTED';
    $('risk-badge').className = `badge ${ready ? 'amber' : 'red'}`;
    set('risk-badge', ready ? 'AMBER · CLI PREFLIGHT REQUIRED' : 'RED · NOT EXECUTABLE');
    set('risk-explanation', 'This dashboard never signs. Nonce, margin preview, gas estimate, expiry, mark deviation and simulation require a fresh exact CLI plan. NOT_RUN is not FAILED.');
    set('risk-reasons', m?.book?.reasons?.length ? m.book.reasons.join(' · ') :
      ready ? 'Market observation is trusted; run canary-first-proof for complete preflight.' :
        'Book or grant is unavailable. Refresh read-only data before planning.');
  }
  function updatePreview() {
    const price = Number($('limit-price').value), quantity = Number($('quantity').value);
    set('notional', price > 0 && quantity > 0 && Number.isFinite(price * quantity) ? `${money(price * quantity)} USDso` : '—');
    set('gas-estimate', 'NOT_RUN'); set('margin-preview', 'NOT_RUN');
  }
  function updateBookFreshness() {
    if (trustedBook()) return;
    set('best-bid', '—'); set('best-ask', '—'); set('spread', '—');
    set('book-bid', '—'); set('book-ask', '—'); set('book-spread', '—');
    set('book-status', 'BOOK · UNTRUSTED'); set('market-age', 'Book unavailable or stale');
    $('book-badge').className = 'badge red'; set('book-badge', 'UNTRUSTED');
    $('depth-asks').replaceChildren(); $('depth-bids').replaceChildren();
    $('use-bid').disabled = true; $('use-ask').disabled = true;
    document.querySelectorAll('[data-offset]').forEach(button => { button.disabled = true; });
  }
  function renderMarket(m) {
    state.market = m;
    const fresh = trustedBook();
    set('rpc-pill', `RPC · LIVE #${m.block}`); $('rpc-pill').className = 'pill good';
    set('bot-pill', `BOT · ${m.bot.placeGrant === 'SUPPORTED' ? 'GRANTED' : m.bot.placeGrant}`);
    $('bot-pill').className = `pill ${m.bot.placeGrant === 'SUPPORTED' ? 'good' : 'bad'}`;
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
    $('use-bid').disabled = !fresh; $('use-ask').disabled = !fresh;
    document.querySelectorAll('[data-offset]').forEach(button => { button.disabled = !fresh; });
    if (m.mark != null && Number.isFinite(Number(m.mark))) {
      state.observations.push({ time: Date.now(), price: Number(m.mark), block: m.block });
      if (state.observations.length > 90) state.observations.shift();
      drawChart();
    }
    updateBookFreshness();
    updateRisk(); updatePreview();
  }
  function timelineItem(name, detail) {
    const li = document.createElement('li'), strong = document.createElement('strong'), span = document.createElement('span');
    strong.textContent = name; span.textContent = detail; li.append(strong, span); return li;
  }
  function renderHistory(h) {
    state.history = h;
    set('position-size', `${h.position.sizeBtc} BTC`); set('entry-price', `${money(h.position.entryPrice)} USDso`);
    set('position-block', `BLOCK ${h.position.block}`); set('open-count', h.openOrders.length);
    set('order-state', h.lifecycle.state); set('order-cause', h.lifecycle.cause);
    const body = $('orders-body'); body.replaceChildren();
    if (!h.openOrders.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 5; td.textContent = `No open BTC-PERP orders at block ${h.readBlock}`; tr.append(td); body.append(tr); }
    for (const row of h.openOrders) {
      const tr = document.createElement('tr');
      for (const value of [row.id, row.side, money(row.price), row.remaining, 'OPEN_AT_READ']) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      } body.append(tr);
    }
    const items = h.events.map(e => timelineItem(e.name, `Block ${e.block} · tx ${e.txHash.slice(0, 12)}… · ${e.source}${e.quantityRaw ? ` · ${Number(e.quantityRaw) / 1e8} BTC` : ''}`));
    items.push(timelineItem(h.lifecycle.state, `Open-order and position read at block ${h.readBlock}; events scanned through ${h.scanThroughBlock}. Cause: ${h.lifecycle.cause}.`));
    $('timeline').replaceChildren(...items);
  }
  function renderProof(p) {
    state.proof = p;
    $('proof-lead').hidden = false;
    $('proof-badge').className = 'badge green'; set('proof-badge', 'VERIFIED');
    for (const [id, value] of [['tx-hash', p.txHash], ['order-id', p.orderId], ['plan-hash', p.planHash],
      ['proof-hash', p.proofHash], ['receipt-block', p.block], ['gas-used', `${p.gasUsed} units`]]) set(id, value);
  }
  async function copy(value, label) {
    if (!value) return;
    try { await window.navigator.clipboard.writeText(value); set('copy-feedback', `${label} copied`); }
    catch { set('copy-feedback', 'Clipboard unavailable. Use the local CLI output instead.'); }
  }
  async function loadPlan() {
    try {
      const plan = await read('/api/v1/terminal/plan'); state.plan = plan;
      const active = plan && Date.now() < Date.parse(plan.expiresAt);
      $('copy-active-plan').disabled = !active; $('copy-execute').disabled = !active; $('copy-confirmation').disabled = !active;
      set('plan-state', active ? `Active saved plan ${plan.hash}. Expires ${new Date(plan.expiresAt).toLocaleTimeString()}; CLI rechecks all gates.` :
        'No unexpired saved plan. Create a fresh one in the owner CLI. The verified first plan has expired.');
    } catch (error) { state.plan = null; set('plan-state', `Plan lookup unavailable: ${error.message}`); }
  }
  async function loadMarket() {
    if (state.marketBusy) return; state.marketBusy = true; $('refresh').disabled = true;
    try { renderMarket(await read('/api/v1/terminal/market')); }
    catch (error) { set('rpc-pill', 'RPC · UNKNOWN'); $('rpc-pill').className = 'pill bad';
      state.market = null; set('book-reasons', error.message); updateRisk(); }
    finally { state.marketBusy = false; $('refresh').disabled = false; }
  }
  async function loadHistory() {
    if (state.historyBusy) return; state.historyBusy = true;
    try { renderHistory(await read('/api/v1/terminal/history')); }
    catch (error) { $('timeline').replaceChildren(timelineItem('UNKNOWN', `Read-only RPC history unavailable: ${error.message}`));
      set('order-state', 'UNKNOWN'); set('order-cause', 'UNKNOWN');
      set('position-size', 'UNKNOWN'); set('entry-price', 'UNKNOWN'); set('open-count', 'UNKNOWN');
      set('position-block', 'BLOCK UNKNOWN'); $('orders-body').replaceChildren(); }
    finally { state.historyBusy = false; }
  }
  $('refresh').onclick = () => { loadMarket(); loadHistory(); loadPlan(); };
  $('quantity').oninput = updatePreview; $('limit-price').oninput = updatePreview;
  $('use-bid').onclick = () => { if (trustedBook()) { $('limit-price').value = state.market.book.bid; updatePreview(); } };
  $('use-ask').onclick = () => { if (trustedBook()) { $('limit-price').value = state.market.book.ask; updatePreview(); } };
  document.querySelectorAll('[data-offset]').forEach(button => { button.onclick = () => {
    if (!trustedBook()) return;
    const bid = Number(state.market.book.bid), tick = Number(state.market.grid.tickSizeRaw) / 1e18;
    if (!Number.isFinite(tick) || tick <= 0) return;
    $('limit-price').value = (Math.floor((bid * (1 - Number(button.dataset.offset) / 10000)) / tick) * tick).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
    updatePreview();
  }; });
  $('copy-prepare').onclick = () => copy('npm.cmd run canary-first-proof', 'Owner prepare command');
  document.querySelectorAll('[data-copy]').forEach(button => { button.onclick = () => {
    const p = state.proof; if (!p) return;
    const key = button.dataset.copy;
    copy(key === 'tx' ? p.txHash : key === 'plan' ? p.planHash : p.proofHash, `${key} hash`);
  }; });
  $('copy-execute').onclick = () => { if (state.plan && Date.now() < Date.parse(state.plan.expiresAt))
    copy(`npm.cmd run bot-execute -- execute ${state.plan.hash}`, 'Execute command'); };
  $('copy-active-plan').onclick = () => { if (state.plan && Date.now() < Date.parse(state.plan.expiresAt))
    copy(state.plan.hash, 'Active plan hash'); };
  $('copy-confirmation').onclick = () => { if (state.plan && Date.now() < Date.parse(state.plan.expiresAt))
    copy(`EXECUTE ${state.plan.hash}`, 'Exact confirmation'); };
  updateRisk(); drawChart();
  read('/api/v1/terminal/proof').then(renderProof).catch(error => {
    $('proof-badge').className = 'badge red'; set('proof-badge', 'UNKNOWN');
    set('proof-hash', `UNKNOWN: ${error.message}`);
  });
  loadMarket(); loadHistory(); loadPlan();
  window.setInterval(loadMarket, 30000); window.setInterval(loadHistory, 60000); window.setInterval(loadPlan, 10000);
  window.setInterval(() => { if (state.market) { updateBookFreshness(); updateRisk(); }
    if (state.plan && Date.now() >= Date.parse(state.plan.expiresAt)) loadPlan(); }, 5000);
})();

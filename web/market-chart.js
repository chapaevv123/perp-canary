(() => {
  const panel = document.querySelector('.chart-panel');
  const wrap = panel.querySelector('.chart-wrap');
  const controls = document.createElement('div'); controls.className = 'chart-controls';
  controls.innerHTML = '<label for="candle-interval">Fill-derived OHLCV</label><select id="candle-interval" aria-label="Candle timeframe"><option value="60">1m</option><option value="300" selected>5m</option><option value="900">15m</option><option value="3600">1h</option><option value="14400">4h</option><option value="86400">1d</option></select><button id="candle-reset" type="button" class="button secondary" disabled>Reset view</button><span id="candle-status" role="status">Loading real fill-derived history…</span>';
  panel.querySelector('.panel-head').after(controls);
  const canvas = document.createElement('canvas'); canvas.id = 'candle-canvas';
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Indexed fill-derived candle chart');
  canvas.hidden = true; wrap.prepend(canvas);
  const hover = document.createElement('div'); hover.id = 'candle-hover'; hover.className = 'small';
  hover.textContent = 'Wheel to zoom · drag to pan · hover or tap for OHLC and real volume.'; wrap.after(hover);
  const tape = document.createElement('div'); tape.className = 'market-tape';
  tape.innerHTML = '<div class="section-line"><strong>Recent market fills</strong><span id="tape-status">Loading indexed fills…</span></div><div id="tape-rows"></div>';
  panel.append(tape);
  const state = { symbol: document.getElementById('market-select').value, interval: 300,
    candles: [], chartRequest: 0, tapeRequest: 0, chartAt: 0, tapeAt: 0, hover: -1,
    hoverY: null, viewCount: 0, viewOffset: 0, drag: null };
  const original = wrap.querySelector('svg');
  const empty = document.getElementById('chart-empty');
  function reset() {
    state.candles = []; state.hover = -1; state.hoverY = null; state.viewCount = 0;
    state.viewOffset = 0; state.drag = null; state.chartAt = 0; state.tapeAt = 0;
    document.getElementById('candle-reset').disabled = true;
    state.chartRequest++; state.tapeRequest++; canvas.hidden = true; original.hidden = false;
    panel.querySelector('h2').textContent = `${state.symbol} live mark trace`;
    empty.hidden = false; document.getElementById('candle-status').textContent = 'Loading real fill-derived history…';
    document.getElementById('tape-status').textContent = 'Loading indexed fills…';
    document.getElementById('tape-rows').replaceChildren();
  }
  async function read(url) {
    const controller = new window.AbortController(); const timer = setTimeout(() => controller.abort(), 35_000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      const value = await response.json();
      if (!response.ok) throw Error(value.error || `HTTP ${response.status}`);
      return value;
    } finally { window.clearTimeout(timer); }
  }
  function visibleRows() {
    const count = Math.min(state.viewCount || state.candles.length, state.candles.length);
    const end = state.candles.length - state.viewOffset;
    return state.candles.slice(Math.max(0, end - count), end);
  }
  function draw() {
    const rows = visibleRows();
    if (!rows.length || canvas.hidden) return;
    canvas.dataset.viewCount = String(rows.length);
    canvas.dataset.viewOffset = String(state.viewOffset);
    const box = wrap.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(320, Math.floor(box.width)), height = Math.max(230, Math.floor(box.height));
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    ctx.fillStyle = '#101722'; ctx.fillRect(0, 0, width, height);
    const left = 12, right = 72, top = 18, bottom = 54, volumeHeight = 40;
    const plotWidth = width - left - right, plotHeight = height - top - bottom - volumeHeight;
    const highs = rows.map(row => Number(row.high)), lows = rows.map(row => Number(row.low));
    const high = Math.max(...highs), low = Math.min(...lows), span = Math.max(high - low, high * 0.0002);
    const y = price => top + (high - price) / span * plotHeight;
    ctx.strokeStyle = '#2d3848'; ctx.lineWidth = 1; ctx.font = '12px system-ui'; ctx.fillStyle = '#a9bbca';
    for (let i = 0; i <= 4; i++) {
      const yy = top + i * plotHeight / 4;
      ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(width - right + 5, yy); ctx.stroke();
      ctx.fillText((high - span * i / 4).toLocaleString('en-US', { maximumFractionDigits: 2 }), width - right + 10, yy + 4);
    }
    const lastPrice = Number(rows.at(-1).close), lastY = y(lastPrice);
    ctx.strokeStyle = '#b29cff'; ctx.setLineDash([4, 4]); ctx.beginPath();
    ctx.moveTo(left, lastY); ctx.lineTo(width - right, lastY); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#b29cff'; ctx.fillText(lastPrice.toLocaleString('en-US', { maximumSignificantDigits: 8 }),
      width - right + 8, Math.max(13, Math.min(height - bottom, lastY + 4)));
    const slot = plotWidth / rows.length, candleWidth = Math.max(2, Math.min(10, slot * 0.65));
    const maxVolume = Math.max(...rows.map(row => Number(row.volumeBase)), 0.000001);
    rows.forEach((row, i) => {
      const x = left + (i + 0.5) * slot, up = Number(row.close) >= Number(row.open);
      ctx.strokeStyle = up ? '#38c99a' : '#f07883'; ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.moveTo(x, y(Number(row.high))); ctx.lineTo(x, y(Number(row.low))); ctx.stroke();
      const yOpen = y(Number(row.open)), yClose = y(Number(row.close));
      ctx.fillRect(x - candleWidth / 2, Math.min(yOpen, yClose), candleWidth, Math.max(1, Math.abs(yClose - yOpen)));
      const vol = Number(row.volumeBase) / maxVolume * volumeHeight;
      ctx.globalAlpha = 0.45; ctx.fillRect(x - candleWidth / 2, height - bottom - vol + volumeHeight, candleWidth, vol); ctx.globalAlpha = 1;
    });
    if (state.hover >= 0 && state.hover < rows.length) {
      const x = left + (state.hover + 0.5) * slot;
      ctx.strokeStyle = '#c4d5e5'; ctx.setLineDash([3, 4]); ctx.beginPath();
      ctx.moveTo(x, top); ctx.lineTo(x, height - 13); ctx.stroke(); ctx.setLineDash([]);
      if (state.hoverY != null && state.hoverY >= top && state.hoverY <= top + plotHeight) {
        ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(left, state.hoverY);
        ctx.lineTo(width - right, state.hoverY); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    const first = new Date(rows[0].time * 1000), last = new Date(rows.at(-1).time * 1000);
    ctx.fillStyle = '#8fa4b8'; ctx.fillText(first.toLocaleString(), left, height - 12);
    const label = last.toLocaleString(); ctx.fillText(label, Math.max(left, width - right - ctx.measureText(label).width), height - 12);
  }
  function showHover() {
    const row = visibleRows()[state.hover];
    hover.textContent = row ? `${new Date(row.time * 1000).toLocaleString()} · O ${row.open} H ${row.high} L ${row.low} C ${row.close} USDso · ${row.volumeBase} base volume · ${row.trades} fills` :
      'Wheel to zoom · drag to pan · hover or tap for OHLC and real volume.';
    draw();
  }
  canvas.addEventListener('pointermove', event => {
    const rect = canvas.getBoundingClientRect();
    if (state.drag) {
      const step = (rect.width - 84) / Math.max(1, visibleRows().length);
      state.viewOffset = Math.max(0, Math.min(state.candles.length - state.viewCount,
        state.drag.offset + Math.round((event.clientX - state.drag.x) / step)));
    }
    state.hover = Math.min(visibleRows().length - 1, Math.max(0,
      Math.floor((event.clientX - rect.left - 12) / ((rect.width - 84) / visibleRows().length))));
    state.hoverY = event.clientY - rect.top;
    showHover();
  });
  canvas.addEventListener('pointerdown', event => { if (!state.candles.length) return;
    state.drag = { x: event.clientX, offset: state.viewOffset }; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointerup', () => { state.drag = null; });
  canvas.addEventListener('pointercancel', () => { state.drag = null; });
  canvas.addEventListener('pointerleave', () => { if (state.drag) return;
    state.hover = -1; state.hoverY = null; showHover(); });
  canvas.addEventListener('wheel', event => { if (!state.candles.length) return;
    event.preventDefault();
    const current = state.viewCount || state.candles.length;
    const next = current + (event.deltaY > 0 ? 1 : -1) * Math.max(4, Math.round(current * 0.15));
    state.viewCount = Math.max(Math.min(20, state.candles.length), Math.min(state.candles.length, next));
    state.viewOffset = Math.min(state.viewOffset, state.candles.length - state.viewCount);
    state.hover = -1; showHover();
  }, { passive: false });
  document.getElementById('candle-reset').onclick = () => {
    state.viewCount = state.candles.length; state.viewOffset = 0; state.hover = -1; showHover();
  };
  new window.ResizeObserver(draw).observe(wrap);
  async function loadCandles() {
    const id = ++state.chartRequest, symbol = state.symbol, interval = state.interval;
    state.chartAt = Date.now();
    document.getElementById('candle-status').textContent = 'Loading indexed candles…';
    try {
      const result = await read(`/api/v1/markets/candles?market=${encodeURIComponent(symbol)}&interval=${interval}`);
      if (id !== state.chartRequest || symbol !== state.symbol || interval !== state.interval) return;
      state.chartAt = Date.now();
      const rows = Array.isArray(result.candles) ? result.candles.filter(row =>
        Number.isFinite(Number(row.time)) && Number.isFinite(Number(row.high)) && Number.isFinite(Number(row.low)) &&
        Number(row.high) >= Number(row.low) && Number(row.low) > 0) : [];
      state.candles = rows; state.viewCount = Math.min(state.viewCount || rows.length, rows.length);
      state.viewOffset = Math.min(state.viewOffset, Math.max(0, rows.length - state.viewCount));
      document.getElementById('candle-reset').disabled = !rows.length;
      canvas.hidden = !rows.length; original.hidden = !!rows.length; empty.hidden = !!rows.length;
      document.getElementById('candle-status').textContent = rows.length ?
        `${rows.length} real fill-derived candles · official SDK indexer · checked ${new Date(result.observedAt).toLocaleTimeString()} · newest bucket may lag` :
        `History unavailable: ${result.reason || 'no indexed fill buckets'}. Live mark trace remains below.`;
      if (rows.length) { panel.querySelector('h2').textContent = `${symbol} fill-derived OHLCV`; draw(); }
      else panel.querySelector('h2').textContent = `${symbol} live mark trace`;
    } catch (error) { if (id === state.chartRequest) {
      state.candles = []; canvas.hidden = true; original.hidden = false;
      document.getElementById('candle-status').textContent = `Indexed history unavailable: ${error.message}. Live mark trace remains available when RPC recovers.`;
    } }
  }
  async function loadTrades() {
    const id = ++state.tapeRequest, symbol = state.symbol;
    state.tapeAt = Date.now();
    try {
      const result = await read(`/api/v1/markets/trades?market=${encodeURIComponent(symbol)}`);
      if (id !== state.tapeRequest || symbol !== state.symbol) return;
      state.tapeAt = Date.now();
      document.getElementById('tape-status').textContent = result.trades.length ?
        `SDK indexer · ${new Date(result.observedAt).toLocaleTimeString()} · may lag` : 'No indexed fills for this market';
      const rows = result.trades.slice(0, 12).map(trade => {
        const row = document.createElement('div'); row.className = 'tape-row';
        row.textContent = `${new Date(trade.time * 1000).toLocaleTimeString()}   ${trade.side}   ${trade.price} USDso   ${trade.quantity} ${symbol.replace('-PERP', '')}`;
        row.title = `${trade.txHash} · block ${trade.block ?? 'indexer pending'}`; return row;
      });
      document.getElementById('tape-rows').replaceChildren(...rows);
    } catch (error) { if (id === state.tapeRequest)
      document.getElementById('tape-status').textContent = `Recent fills unavailable: ${error.message}`; }
  }
  document.getElementById('candle-interval').addEventListener('change', event => {
    state.interval = Number(event.target.value); state.chartAt = 0; loadCandles();
  });
  document.getElementById('market-select').addEventListener('change', event => {
    state.symbol = event.target.value; reset(); loadCandles(); loadTrades();
  });
  window.addEventListener('canary:market', event => {
    if (event.detail?.market !== state.symbol) return;
    if (state.candles.length) { empty.hidden = true; panel.querySelector('h2').textContent = `${state.symbol} fill-derived OHLCV`; }
    if (Date.now() - state.chartAt > 30_000) loadCandles();
    if (Date.now() - state.tapeAt > 30_000) loadTrades();
  });
  loadCandles(); loadTrades();
})();

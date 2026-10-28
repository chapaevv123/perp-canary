(() => {
  const nav = document.querySelector('.topbar nav');
  const trigger = document.createElement('button'); trigger.type = 'button';
  trigger.className = 'replay-trigger'; trigger.textContent = 'Verified trade';
  trigger.title = 'Inspect the on-chain BTC order placement and full fill'; nav.append(trigger);
  const dialog = document.createElement('dialog'); dialog.className = 'execution-replay';
  dialog.setAttribute('aria-label', 'Verified execution replay');
  dialog.innerHTML = '<div class="replay-head"><div><span class="eyebrow">EVIDENCE-BACKED EXECUTION REPLAY</span><h2>BTC-PERP · verified full fill</h2></div><button class="button secondary" type="button" id="replay-close">Close</button></div><p id="replay-status" role="status">Loading verified evidence…</p><div id="replay-identity"></div><ol id="replay-steps"></ol><p id="replay-limit" class="small"></p>';
  document.body.append(dialog);
  dialog.querySelector('#replay-close').onclick = () => dialog.close();
  let loaded = false;
  trigger.onclick = async () => {
    dialog.showModal(); if (loaded) return;
    try {
      const controller = new window.AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
      let response;
      try { response = await fetch('/api/v1/execution/replay?orderId=14978756187852164141712',
        { signal: controller.signal, cache: 'no-store' }); }
      finally { window.clearTimeout(timer); }
      const data = await response.json(); if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
      if (data.chainId !== 50383 || data.orderId !== '14978756187852164141712' || !Array.isArray(data.steps))
        throw Error('Replay identity check failed');
      dialog.querySelector('#replay-status').textContent = `HISTORICAL VERIFIED · Hideki 50383 · bundle checked ${new Date(data.observedAt).toLocaleString()}`;
      dialog.querySelector('#replay-identity').textContent = `Order #${data.orderId} · operator ${data.operator} · margin owner ${data.owner}`;
      const list = data.steps.map(step => {
        const li = document.createElement('li');
        const title = document.createElement('strong'); title.textContent = `${step.label} · ${step.status}`;
        const detail = document.createElement('p'); detail.textContent = step.detail;
        const meta = document.createElement('small'); meta.textContent = `${step.source}${step.block ? ` · block ${step.block}` : ''}${step.hash ? ` · ${step.hash}` : ''}`;
        li.append(title, detail, meta); return li;
      });
      dialog.querySelector('#replay-steps').replaceChildren(...list);
      dialog.querySelector('#replay-limit').textContent = data.limitation;
      loaded = true;
    } catch (error) { dialog.querySelector('#replay-status').textContent = `Replay unavailable: ${error.message}. Retry by reopening.`; }
  };
})();

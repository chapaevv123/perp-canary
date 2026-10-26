(() => {
  const $ = id => document.getElementById(id);
  const add = (parent, tag, value, className) => {
    const element = document.createElement(tag);
    element.textContent = String(value);
    if (className) element.className = className;
    parent.append(element);
    return element;
  };
  $('authorizationForm').onsubmit = async event => {
    event.preventDefault();
    $('authorizationState').textContent = 'Reading Hideki permissions, market, gas and margin…';
    $('authorizationResults').replaceChildren();
    try {
      const body = { eoa: $('authEoa').value.trim(), tradingWallet: $('authTrading').value.trim(),
        operator: $('authOperator').value.trim(), pool: $('authPool').value.trim(),
        side: $('authSide').value || undefined, price: $('authPrice').value.trim() || undefined,
        quantity: $('authQuantity').value.trim() || undefined };
      const response = await fetch('/api/v1/trading-authorization', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const type = response.headers.get('content-type') || '';
      if (!type.toLowerCase().includes('application/json')) throw Error(`HTTP ${response.status}: non-JSON server response. Restart Perp Canary.`);
      const result = await response.json();
      if (!response.ok) throw Error(`${result.code || 'READ_FAILED'} · ${result.error || 'HTTP ' + response.status}`);
      $('authorizationState').textContent = `${result.authorization.status} · Hideki ${result.chainId} · block ${result.sampledBlock} · execution locked`;
      const box = $('authorizationResults');
      const table = document.createElement('table');
      const row = (label, value, source) => { const tr = document.createElement('tr');
        add(tr, 'td', label); add(tr, 'td', value, 'mono'); add(tr, 'td', source || 'UNKNOWN'); table.append(tr); };
      row('Connected EOA', result.connectedEoa, 'User input; login link UNKNOWN');
      row('Trading wallet / position owner', result.tradingWallet, 'User input and M2.5 OrderPlaced');
      row('M2.5 execution signer / gas payer', result.historicalExecutionSigner, 'Verified transaction sender; current key access UNKNOWN');
      row('Candidate operator', result.candidateOperator, 'User input or historical sender; control UNKNOWN');
      row('isOwner', `${result.isOwner.status} · ${result.isOwner.value}`, result.isOwner.source);
      row('Registry', `${result.registryMatches.status} · ${result.registry}`, result.registryMatches.source);
      for (const [name, grant] of Object.entries(result.permissions)) {
        row(`${name} effective`, `${grant.effective.status} · ${grant.effective.value}`, grant.effective.source);
        row(`${name} global / pool`, `${grant.global.value} / ${grant.perPool.value}`, grant.global.source);
      }
      row('Operator STT', result.operatorGasStt, 'eth_getBalance on Hideki');
      row('MarginBank unlocked USDso', result.marginBankUnlocked, 'Markets SDK getMarginAccount; owner address only');
      row('Simulation', `${result.simulation.status} · ${result.simulation.value}`, result.simulation.source);
      row('Revoke capability', result.revokeCapability.value, result.revokeCapability.source);
      box.append(table);
      add(box, 'h3', 'Execution path assessment');
      for (const route of result.routes) add(box, 'p', `${route.status} · ${route.route}: ${route.reason}`, 'small');
      add(box, 'h3', 'Blockers and next step');
      add(box, 'p', [...result.authorization.blockers, ...result.planBlockers].join('; ') || 'No specific blocker observed; execution remains locked.', 'small');
      add(box, 'p', result.authorization.nextStep, 'small');
      if (result.unsigned) {
        add(box, 'h3', 'Unsigned, short-lived prototype');
        add(box, 'pre', JSON.stringify(result.unsigned, null, 2));
      }
      add(box, 'p', `Sources checked 2026-10-26: ${result.sources.join(' · ')}`, 'small mono');
    } catch (error) {
      $('authorizationState').textContent = `UNKNOWN · ${error instanceof Error ? error.message : 'Read-only diagnostic failed'}`;
    }
  };
})();

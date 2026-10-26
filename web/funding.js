/* Read-only network and funding view. No wallet provider or transaction calls. */
(() => {
  const byId = id => document.getElementById(id);
  const node = (tag, value) => { const element = document.createElement(tag); if (value !== undefined) element.textContent = String(value); return element; };
  const line = (box, value) => box.append(node('p', value));
  const heading = (box, value) => box.append(node('h3', value));
  const fact = (value, status) => `${status || 'UNKNOWN'} · ${value ?? 'UNKNOWN'}`;
  async function readFundingJson(options) {
    const response = await fetch('/api/v1/network-funding', options);
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json'))
      throw Error(`Funding endpoint returned non-JSON HTTP ${response.status}; restart the Perp Canary server.`);
    let result;
    try { result = JSON.parse(await response.text()); }
    catch { throw Error(`Funding endpoint returned invalid JSON (HTTP ${response.status}).`); }
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error('Funding endpoint returned an invalid response.');
    if (!response.ok) throw Error(typeof result.error === 'string' ? result.error : `Funding HTTP ${response.status}`);
    return result;
  }
  const fundingForm = byId('fundingForm');
  if (!fundingForm) return;
  fundingForm.addEventListener('submit', async event => {
    event.preventDefault();
    const state = byId('fundingState');
    const box = byId('fundingResults');
    state.className = 'notice';
    state.textContent = 'Reading chain IDs, balances and Hideki MarginBank…';
    box.replaceChildren();
    const button = fundingForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const payload = {
        eoa: byId('fundingEoa').value.trim() || byId('diagnosticEoa').value.trim() || byId('account').value.trim(),
        tradingAccount: byId('fundingTrading').value.trim() || byId('diagnosticTrading').value.trim(),
        reportedUiAmount: byId('fundingAmount').value.trim(), reportedUiSymbol: byId('fundingSymbol').value.trim(),
        pool: byId('pool').value || byId('pool').options[1]?.value || '',
      };
      const result = await readFundingJson({ method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const readiness = result.fundingReadiness;
      state.textContent = `${readiness.status} · ${readiness.reasons.join('; ')}`;
      if (['BLOCKED', 'RPC_ERROR'].includes(readiness.status)) state.className = 'notice error';
      heading(box, 'A. Active Perps Network');
      line(box, 'Hideki 50383 · verified perp deployment · no automatic wallet switching');
      heading(box, 'B. Network Compatibility');
      for (const network of result.networkCompatibility)
        line(box, `${network.chainId}: ${network.status} · ${network.reason}`);
      heading(box, 'C. Wallet Balance Matrix');
      const table = node('table');
      const header = node('tr');
      for (const title of ['Network / chain', 'Wallet / address', 'Native gas', 'ERC-20', 'Perp MarginBank / position', 'RPC']) header.append(node('th', title));
      table.append(header);
      for (const probe of result.probes) {
        const rows = probe.accounts.length ? probe.accounts : [null];
        for (const account of rows) {
          const row = node('tr');
          const metadata = result.networkRegistry.find(item => item.chainId === probe.chainId);
          const symbol = metadata?.tokenMetadata?.[0]?.symbol || 'UNKNOWN';
          const margin = result.perps?.accounts?.find(item => item.address.toLowerCase() === account?.address.toLowerCase());
          const erc20 = account ? Object.entries(account.erc20).map(([token, balance]) => `${token}: ${fact(balance.value, balance.status)}`).join('; ') || 'UNSUPPORTED' : 'UNKNOWN';
          const marginText = probe.chainId !== 50383 ? 'UNSUPPORTED' : margin ?
            `free ${fact(margin.marginBankUnlocked.value, margin.marginBankUnlocked.status)}; locked ${fact(margin.marginBankLocked.value, margin.marginBankLocked.status)}; voucher floor ${fact(margin.voucherFloor.value, margin.voucherFloor.status)}; selected position ${fact(margin.positionSize.value, margin.positionSize.status)}; active pools ${fact(margin.activePerpPools.value, margin.activePerpPools.status)}` : 'UNKNOWN';
          for (const value of [`${probe.name} / ${probe.chainId}`, account ? `${account.role} · ${account.address}` : 'UNKNOWN',
            account ? `${fact(account.native.value, account.native.status)} ${symbol}` : 'UNKNOWN', erc20, marginText,
            `${probe.status} · block ${probe.blockNumber ?? 'UNKNOWN'} · ${probe.errorCode ?? 'OK'}`]) row.append(node('td', value));
          table.append(row);
        }
      }
      box.append(table);
      heading(box, 'D. Funding Readiness');
      line(box, `${readiness.status} · ${readiness.reasons.join('; ')}`);
      line(box, `Global balance ${result.appBalances.global}; Spot balance ${result.appBalances.spot}; wallet relationship ${result.perps?.roles?.relationship?.status || 'UNKNOWN'}`);
      heading(box, 'E. Recommended Next Action');
      line(box, readiness.nextAction);
      for (const route of result.routes) {
        line(box, `${route.id}: ${route.status} / availability ${route.availability} · ${route.sourceNetwork} → ${route.destinationNetwork} · ${route.asset} · ${route.requiredUserAction}`);
        const link = node('a', `Official route: ${route.officialUrl}`);
        link.href = route.officialUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; box.append(link);
      }
      heading(box, 'F. Evidence / Provenance');
      const comparison = result.uiAmountComparison;
      line(box, `${comparison.status} · ${comparison.reported ?? 'no reported amount'} · ${comparison.note}`);
      if (comparison.matched) line(box, `Numerical match: ${comparison.matched.chainId} ${comparison.matched.address} ${comparison.matched.value} ${comparison.matched.nativeSymbol}`);
      for (const network of result.networkRegistry) {
        line(box, `${network.name} · verified ${network.verificationTimestamp} · RPC ${network.rpc} · contracts ${JSON.stringify(network.verifiedContractAddresses)}`);
        for (const url of network.provenance) {
          const link = node('a', url); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
          box.append(link, node('br'));
        }
      }
      for (const probe of result.probes) for (const account of probe.accounts) {
        line(box, `${probe.chainId} ${account.address}: native ${account.native.source}; ${Object.entries(account.erc20).map(([token, balance]) => `${token} ${balance.source}`).join('; ')}`);
      }
      for (const account of result.perps?.accounts || [])
        line(box, `${account.address}: MarginBank ${account.marginBankUnlocked.source}; voucher ${account.voucherFloor.source}; position ${account.positionSize.source}`);
      line(box, result.limitations.join(' '));
    } catch (error) {
      state.className = 'notice error';
      state.textContent = error instanceof Error ? error.message : 'Network read unavailable; no zero balance inferred';
    } finally { button.disabled = false; }
  });
})();

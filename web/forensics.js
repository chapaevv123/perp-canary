/* Public transaction reads only. No provider calls, signatures or sends. */
(() => {
  const byId = id => document.getElementById(id);
  const element = (tag, value) => { const node = document.createElement(tag); if (value !== undefined) node.textContent = String(value); return node; };
  const add = (box, label, value) => box.append(element('p', `${label}: ${value ?? 'UNKNOWN'}`));
  const heading = (box, title) => box.append(element('h3', title));
  async function readForensicsJson(options) {
    const response = await fetch('/api/v1/trade-forensics', options);
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json'))
      throw Error(`Forensics endpoint returned non-JSON HTTP ${response.status}; restart the Perp Canary server.`);
    let value;
    try { value = JSON.parse(await response.text()); }
    catch { throw Error(`Forensics endpoint returned invalid JSON (HTTP ${response.status}).`); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Forensics endpoint returned an invalid response.');
    if (!response.ok) throw Error(typeof value.error === 'string' ? value.error : `Forensics HTTP ${response.status}`);
    return value;
  }
  const form = byId('forensicsForm');
  if (!form) return;
  byId('forensicsHash').value = '0xe164fc656bd996ce7be711a4753bb40f6088f18e8abe7dc60b530fa68d4a79cc';
  byId('forensicsWallet').value = '0xE350c75b3B152CC5481FFE13c8078Ab35c90b20f';
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const state = byId('forensicsState');
    const box = byId('forensicsResults');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    state.className = 'notice';
    state.textContent = 'Checking chain IDs, transaction, receipt, block and optional call trace…';
    box.replaceChildren();
    try {
      const report = await readForensicsJson({ method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txHash: byId('forensicsHash').value.trim(), tradingWallet: byId('forensicsWallet').value.trim() }) });
      state.textContent = `${report.evidenceConfidence} · ${report.reasons.join('; ')}`;
      state.className = report.evidenceConfidence === 'MISMATCH' ? 'notice error' : 'notice';
      heading(box, 'Network and receipt');
      for (const network of report.networkLookups)
        add(box, network.name, `${network.status} · expected ${network.expectedChainId} · observed ${network.observedChainId ?? 'UNKNOWN'}`);
      const tx = report.transaction, receipt = report.receipt;
      add(box, 'BTC-PERP market identity', `${report.marketIdentity.status} · ${report.marketIdentity.symbol ?? 'UNKNOWN'} · ${report.marketIdentity.source}`);
      add(box, 'Transaction status', receipt?.status === '0x1' ? 'SUCCESS' : receipt?.status === '0x0' ? 'REVERTED' : 'UNKNOWN');
      add(box, 'Block', receipt?.blockNumber ? BigInt(receipt.blockNumber).toString() : 'UNKNOWN');
      add(box, 'UTC time', report.block?.timestamp ? new Date(Number(BigInt(report.block.timestamp)) * 1000).toISOString() : 'UNKNOWN');
      add(box, 'From / gas payer', tx?.from); add(box, 'To', tx?.to);
      add(box, 'Gas used', receipt?.gasUsed ? BigInt(receipt.gasUsed).toString() : 'UNKNOWN');
      add(box, 'Effective gas price (wei)', receipt?.effectiveGasPrice ? BigInt(receipt.effectiveGasPrice).toString() : 'UNKNOWN');
      if (tx) add(box, 'Input selector', tx.input.slice(0, 10));
      if (report.decodedCall) box.append(element('pre', JSON.stringify(report.decodedCall, null, 2)));
      heading(box, 'Decoded official SDK events');
      if (!report.decodedEvents.length) add(box, 'Events', 'UNKNOWN · no matching official ABI events');
      for (const item of report.decodedEvents)
        box.append(element('pre', `${item.logIndex} · ${item.address} · ${item.eventName}\n${JSON.stringify(item.args, null, 2)}`));
      add(box, 'Undecoded / unrelated logs', report.unknownLogCount);
      heading(box, 'Wallet attribution and position reconciliation');
      box.append(element('pre', JSON.stringify(report.walletAttribution, null, 2)));
      box.append(element('pre', JSON.stringify(report.positionReconciliation, null, 2)));
      add(box, 'Owner-reported UI comparison', JSON.stringify(report.uiComparison));
      heading(box, 'Evidence confidence and provenance');
      add(box, 'Verdict', report.evidenceConfidence);
      add(box, 'LIVE response SHA-256', report.hash);
      add(box, 'Saved immutable artifact SHA-256', report.savedEvidenceHash ?? 'UNKNOWN');
      add(box, 'Inner call trace', report.internalCalls.status);
      if (report.internalCalls.trace) {
        const targets = new Set(); let count = 0;
        const visit = call => { count++; if (call.to) targets.add(call.to); for (const child of call.calls || []) visit(child); };
        visit(report.internalCalls.trace);
        add(box, 'Trace summary', `${count} calls · targets ${[...targets].slice(0, 15).join(', ')}`);
      }
      for (const source of report.sources) if (source.startsWith('https://')) {
        const link = element('a', source); link.href = source; link.target = '_blank'; link.rel = 'noopener noreferrer';
        box.append(link, element('br'));
      }
      if (report.explorerUrl) {
        const link = element('a', 'Open verified Hideki explorer transaction');
        link.href = report.explorerUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; box.append(link);
      }
    } catch (error) {
      state.className = 'notice error';
      state.textContent = error instanceof Error ? error.message : 'Read-only forensic check failed';
    } finally { button.disabled = false; }
  });
})();

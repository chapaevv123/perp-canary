export function explainGuard(plan, draft, spreadCautionBps = 25) {
  if (!Number.isFinite(spreadCautionBps) || spreadCautionBps < 5 || spreadCautionBps > 100)
    throw Error('Spread caution threshold must be 5–100 bps');
  if (!plan || !plan.observation || !plan.guard) return {
    decision: 'UNAVAILABLE', checks: [], nextAction: 'Retry a fresh order review when market and account reads recover.' };
  const observation = plan.observation, book = observation.book || {}, tx = plan.transaction;
  const blockers = plan.guard.blockers || [], warnings = plan.guard.warnings || [];
  const bid = Number(book.bid), ask = Number(book.ask);
  const spreadBps = bid > 0 && ask > bid ? (ask - bid) / ((ask + bid) / 2) * 10_000 : null;
  const caution = spreadBps !== null && spreadBps > spreadCautionBps;
  const checks = [
    { name: 'Account & network', status: observation.chainId === 50383 ? 'PASS' : 'BLOCKED',
      observed: `${draft.mode === 'DELEGATED_PERPS' ? `Operator ${draft.account}; owner ${draft.owner}` : `Direct ${draft.account}`} · chain ${observation.chainId}`,
      rule: 'Exact selected operator, owner and Hideki 50383', freshness: observation.block || 'unknown' },
    { name: 'Market & book', status: book.status === 'TRUSTED' ? 'PASS' : 'BLOCKED',
      observed: `${draft.market} · bid ${book.bid ?? 'unavailable'} / ask ${book.ask ?? 'unavailable'}`,
      rule: 'Verified pool, pinned SDK + RPC top, fresh noncrossing PostOnly book', freshness: book.block || observation.block || 'unknown' },
    { name: 'Spread', status: spreadBps === null ? 'UNAVAILABLE' : caution ? 'CAUTION' : 'PASS',
      observed: spreadBps === null ? 'No valid trusted bid/ask' : `${spreadBps.toFixed(1)} bps`,
      rule: `Soft caution above ${spreadCautionBps} bps; does not bypass protocol gates`, freshness: book.block || 'unknown' },
    { name: 'Price, size & notional', status: blockers.some(reason => /price|tick|lot|quantity|notional|PostOnly|mark/i.test(reason)) ? 'BLOCKED' : 'PASS',
      observed: `${draft.side} ${draft.quantity} @ ${draft.price} USDso`,
      rule: 'Market tick/lot, minimum quantity, ≤100 USDso and ≤1% mark deviation', freshness: observation.block || 'unknown' },
    { name: 'Margin', status: plan.marginPreview?.sufficient === true ? 'PASS' : 'BLOCKED',
      observed: `Available ${plan.account?.marginUnlocked ?? 'see account strip'} USDso · lock ${plan.marginPreview?.lockUsdso ?? 'unavailable'} USDso`,
      rule: 'Fresh SDK max size and sufficient MarginBank preview', freshness: plan.marginPreview?.asOfBlock || observation.block || 'unknown' },
    { name: 'Delegated grant', status: draft.mode !== 'DELEGATED_PERPS' ? 'NOT_APPLICABLE' : plan.account?.permissions?.place ? 'PASS' : 'BLOCKED',
      observed: draft.mode !== 'DELEGATED_PERPS' ? 'Direct wallet signs for itself' : plan.account?.permissions?.place ? 'Active for selected owner/pool' : 'Inactive or unavailable',
      rule: 'Effective placeOrderFor selector grant re-read before signing', freshness: plan.account?.block || observation.block || 'unknown' },
    { name: 'Gas, nonce & expiry', status: tx ? 'PASS' : 'UNAVAILABLE',
      observed: tx ? `${tx.maxGasCostStt} STT max · nonce ${tx.nonce} · ${tx.expiresAt}` : 'No ready transaction',
      rule: '≤0.1 STT and operator balance; fresh pending nonce and ≤5-minute expiry', freshness: observation.block || 'unknown' },
    { name: 'Contract simulation', status: tx && plan.status === 'READY' ? 'PASS' : 'BLOCKED',
      observed: tx ? `Passed for pool ${tx.to}` : 'No successful simulation',
      rule: 'Exact calldata to verified pool must simulate before wallet confirmation', freshness: observation.block || 'unknown' },
  ];
  const decision = plan.status !== 'READY' || blockers.length ? 'BLOCKED' :
    caution || warnings.length ? 'CAUTION' : 'SAFE TO REVIEW';
  return { decision, checks, blockers, warnings,
    nextAction: decision === 'BLOCKED' ? blockers[0] || 'Fix the blocked check and review again.' :
      decision === 'CAUTION' ? 'Inspect spread and warnings, then decide whether to confirm. Fresh hard checks run again.' :
        'Review exact transaction details. Fresh hard checks run again before wallet confirmation.' };
}

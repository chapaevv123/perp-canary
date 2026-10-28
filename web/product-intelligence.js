export function sourceTime(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  const milliseconds = Number.isFinite(numeric) ? numeric > 1e15 ? numeric / 1e6 :
    numeric > 1e11 ? numeric : numeric * 1000 : Date.parse(String(value));
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : null;
}

export function marketScore(snapshot, registry, now = Date.now()) {
  const age = now - Date.parse(snapshot?.book?.observedAt ?? '');
  const bid = Number(snapshot?.book?.bid), ask = Number(snapshot?.book?.ask);
  const bids = snapshot?.depth?.bids, asks = snapshot?.depth?.asks;
  if (snapshot?.book?.status !== 'TRUSTED' || !Number.isFinite(age) || age < 0 || age > 30_000 ||
    !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= bid ||
    snapshot?.depth?.status !== 'VERIFIED' || !Array.isArray(bids) || !Array.isArray(asks) ||
    !bids.length || !asks.length) return { score: null, reason: 'Fresh trusted bid/ask and verified depth are required.' };
  const spreadBps = (ask - bid) * 20_000 / (ask + bid);
  const bidDepth = bids.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const askDepth = asks.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  if (![spreadBps, bidDepth, askDepth].every(Number.isFinite) || bidDepth <= 0 || askDepth <= 0)
    return { score: null, reason: 'Verified depth quantities are unavailable.' };
  const freshness = age <= 10_000 ? 30 : age <= 20_000 ? 20 : 10;
  const spread = spreadBps <= 5 ? 30 : spreadBps <= 15 ? 23 : spreadBps <= 30 ? 15 : 5;
  const balancedDepthUsdso = Math.min(bidDepth * bid, askDepth * ask);
  const depth = balancedDepthUsdso >= 1000 ? 25 : balancedDepthUsdso >= 100 ? 18 :
    balancedDepthUsdso >= 10 ? 10 : 4;
  const lastTradeAt = sourceTime(registry?.lastTradeAt);
  const lastTradeAge = lastTradeAt === null ? Infinity : now - lastTradeAt;
  const activity = lastTradeAge >= 0 && lastTradeAge <= 3_600_000 ? 15 :
    lastTradeAge <= 86_400_000 ? 8 : 0;
  return { score: freshness + spread + depth + activity, spreadBps, bidDepth, askDepth,
    reason: `Freshness ${freshness}/30; spread ${spread}/30 (${spreadBps.toFixed(2)} bps); balanced visible depth ${depth}/25 (~${balancedDepthUsdso.toFixed(2)} USDso); indexed activity ${activity}/15. Operational data quality only, not return prediction.` };
}

export function evaluateAlert(alert, sample, now = Date.now()) {
  const observedAt = Date.parse(sample?.book?.observedAt ?? '');
  const trusted = sample?.book?.status === 'TRUSTED' && Number.isFinite(observedAt) &&
    observedAt <= now && now - observedAt <= 30_000;
  const previous = alert.lastValue;
  let value = null, triggered = false;
  if (alert.type === 'FEED_STALE' || alert.type === 'FEED_RECOVERED') {
    value = trusted ? 1 : 0;
    triggered = previous !== null && previous !== undefined &&
      (alert.type === 'FEED_STALE' ? previous === 1 && value === 0 : previous === 0 && value === 1);
  } else if (trusted) {
    if (alert.type === 'PRICE_ABOVE' || alert.type === 'PRICE_BELOW') value = Number(sample.mark);
    if (alert.type === 'SPREAD_ABOVE') {
      const bid = Number(sample.book.bid), ask = Number(sample.book.ask);
      if (bid > 0 && ask > bid) value = (ask - bid) * 20_000 / (ask + bid);
    }
    if (alert.type === 'FUNDING_ABOVE') {
      const updatedAt = sourceTime(sample.marketMeta?.fundingUpdatedAt);
      value = updatedAt !== null && now >= updatedAt && now - updatedAt <= 3_600_000 ?
        Number(sample.marketMeta?.fundingRateWindowPercent) : null;
    }
    if (!Number.isFinite(value) || value === null ||
      (alert.type === 'FUNDING_ABOVE' && sample.marketMeta?.fundingRateWindowPercent == null)) value = null;
    const threshold = Number(alert.threshold);
    if (value !== null && Number.isFinite(threshold) && previous !== null && previous !== undefined) {
      triggered = alert.type === 'PRICE_BELOW' ? previous >= threshold && value < threshold :
        previous <= threshold && value > threshold;
    }
  }
  if (triggered && now - Number(alert.triggeredAtMs || 0) < 300_000) triggered = false;
  return { value, triggered, status: value === null ? 'UNAVAILABLE' : trusted ? 'CURRENT' : 'STALE',
    observedAt: Number.isFinite(observedAt) ? new Date(observedAt).toISOString() : null };
}

export function mergeOrderPages(previous, next) {
  const byId = new Map();
  for (const row of [...previous, ...next]) if (row && /^\d+$/.test(String(row.id))) byId.set(String(row.id), row);
  return [...byId.values()];
}

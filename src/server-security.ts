export function localRequestRejection(input: { host?: string; origin?: string; fetchSite?: string;
  method?: string }, port: number): string | null {
  const localHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!localHosts.includes(input.host ?? '')) return 'Localhost Host header required';
  if (input.fetchSite === 'cross-site') return 'Cross-site requests are blocked';
  if (input.method === 'POST' &&
    ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(input.origin ?? ''))
    return 'Same-origin browser request required';
  return null;
}

const PUBLIC_GET = new Set([
  '/', '/index.html', '/terminal.css', '/terminal.js', '/trading.js', '/preflight-compare.js',
  '/position-scenario.js', '/market-chart.js', '/execution-replay.js', '/guard-v2.js',
  '/canary-mark.svg', '/api/v1/health', '/api/v1/markets', '/api/v1/markets/snapshot',
  '/api/v1/markets/candles', '/api/v1/markets/trades', '/api/v1/trade/account',
  '/api/v1/trade/delegated/account', '/api/v1/trade/history', '/api/v1/trade/receipt',
  '/api/v1/trade/delegated/receipt', '/api/v1/trade/action/receipt',
  '/api/v1/wallet/funding', '/api/v1/wallet/identity', '/api/v1/wallet/embedded-ownership',
  '/api/v1/wallet/voucher/receipt', '/api/v1/position/intelligence', '/api/v1/execution/replay',
]);
const PUBLIC_POST = new Set([
  '/api/v1/intelligence/size', '/api/v1/trade/prepare', '/api/v1/trade/delegated/prepare',
  '/api/v1/trade/delegated/cancel/prepare', '/api/v1/trade/action/prepare',
  '/api/v1/wallet/voucher/prepare',
]);
export function publicRouteAllowed(path: string, method?: string): boolean {
  return method === 'GET' ? PUBLIC_GET.has(path) : method === 'POST' && PUBLIC_POST.has(path);
}
export function publicOrigin(): URL | null {
  if (process.env.CANARY_PUBLIC_ENABLED !== '1') return null;
  const raw = process.env.CANARY_PUBLIC_ORIGIN;
  if (!raw) throw Error('CANARY_PUBLIC_ORIGIN is required in public mode');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' ||
    url.search || url.hash || url.origin !== raw || !url.hostname.includes('.'))
    throw Error('CANARY_PUBLIC_ORIGIN must be an exact HTTPS origin with no path');
  return url;
}
export function publicRequestRejection(input: { host?: string; origin?: string; fetchSite?: string;
  method?: string; path: string }, origin: URL): string | null {
  if (input.host !== origin.host) return 'Configured public Host required';
  if (!publicRouteAllowed(input.path, input.method)) return 'Route is not available in public mode';
  if (input.fetchSite === 'cross-site') return 'Cross-site requests are blocked';
  if (input.method === 'POST' && input.origin !== origin.origin)
    return 'Exact HTTPS same-origin request required';
  return null;
}
export function securityHeaders(publicMode: boolean): Record<string, string> {
  return { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    ...(publicMode ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}) };
}

export class RequestLimiter {
  private hits = new Map<string, { start: number; count: number }>();
  allow(key: string, now: number, limit: number): boolean {
    const old = this.hits.get(key);
    if (!old || now - old.start >= 60_000) { this.hits.set(key, { start: now, count: 1 }); return true; }
    if (old.count >= limit) return false;
    old.count++;
    if (this.hits.size > 5000) for (const [entry, value] of this.hits)
      if (now - value.start >= 60_000) this.hits.delete(entry);
    return true;
  }
}

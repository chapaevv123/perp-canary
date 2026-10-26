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

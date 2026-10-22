// Checks the running dev stack, including Vite imports (HTML 200 alone is insufficient).
const web = process.env.NEBULA_WEB_URL || 'http://localhost:5173';
const api = process.env.NEBULA_API_URL || 'http://localhost:3333';
const fetchChecked = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${response.status} ${url}: ${(await response.text()).slice(0, 250)}`);
  return response;
};
const health = await (await fetchChecked(`${api}/health`)).json();
if (health.status !== 'healthy') throw new Error('API readiness is not healthy');
const html = await (await fetchChecked(web)).text();
if (!html.includes('id="root"')) throw new Error('Web entry point is missing');
const seen = new Set(['/src/main.tsx']);
const queue = ['/src/main.tsx'];
let checked = 0;
while (queue.length) {
  const batch = queue.splice(0, 8);
  await Promise.all(batch.map(async path => {
    const response = await fetchChecked(new URL(path, web));
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) throw new Error(`Module returned HTML instead of JavaScript: ${path}`);
    checked++;
    if (!contentType.includes('javascript')) return;
    const source = await response.text();
    for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)["'](\/[^"']+)["']/g)) {
      const dependency = match[1];
      if (dependency.startsWith('//') || seen.has(dependency)) continue;
      seen.add(dependency);
      queue.push(dependency);
      if (seen.size > 1000) throw new Error('Unexpectedly large module graph');
    }
  }));
}
console.log(`API healthy; web entry and ${checked} served modules/assets passed.`);

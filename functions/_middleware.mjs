// Records a hit for each tool page view, fire-and-forget.
//
// Single binding: `KV` (a Cloudflare Workers KV namespace).
// Two key prefixes share that namespace:
//   - hits:<tool>      value: '', metadata: { count }
//   - dedup:<sha256>   value: '1', expirationTtl: 3600
// When KV is unbound, the middleware skips recording and returns the
// downstream response unchanged.

const BOT_RE = /bot|crawler|spider|curl|wget|headless|lighthouse|preview|fetch|monitor/i;
const TOOL_PATH_RE = /^\/([a-z][a-z0-9_]*)\.html$/;

export async function onRequest(context) {
  const { request, env, next } = context;
  const response = await next();

  const tool = toolFromRequest(request, response);
  if (tool && env?.KV) {
    context.waitUntil(recordHit(env.KV, request, tool).catch(() => {}));
  }
  return response;
}

function toolFromRequest(request, response) {
  if (request.method !== 'GET') return null;
  if (response.status !== 200) return null;

  const ct = response.headers.get('content-type') || '';
  if (!ct.toLowerCase().includes('text/html')) return null;

  const ua = request.headers.get('user-agent') || '';
  if (BOT_RE.test(ua)) return null;

  const purpose = request.headers.get('sec-purpose') || request.headers.get('purpose') || '';
  if (purpose.toLowerCase().includes('prefetch')) return null;

  const { pathname } = new URL(request.url);
  const m = pathname.match(TOOL_PATH_RE);
  return m ? m[1] : null;
}

async function recordHit(KV, request, tool) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  const hour = Math.floor(Date.now() / 3_600_000);
  const dedupKey = `dedup:${await sha256(`${ip}|${tool}|${hour}`)}`;

  if (await KV.get(dedupKey)) return;
  await KV.put(dedupKey, '1', { expirationTtl: 3600 });

  const hitsKey = `hits:${tool}`;
  const { metadata } = await KV.getWithMetadata(hitsKey);
  const count = (metadata?.count ?? 0) + 1;
  await KV.put(hitsKey, '', { metadata: { count } });
}

async function sha256(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

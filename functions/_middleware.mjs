// Records a hit for each tool page view, fire-and-forget.
//
// Bindings (configured in the Cloudflare Pages dashboard):
//   - DB:    D1 database `tools_stats` (see schema.sql)
//   - DEDUP: KV namespace for 1-hour idempotency tokens
// Both are optional — when missing, the middleware skips recording and
// returns the downstream response unchanged.

const BOT_RE = /bot|crawler|spider|curl|wget|headless|lighthouse|preview|fetch|monitor/i;
const TOOL_PATH_RE = /^\/([a-z][a-z0-9_]*)\.html$/;

export async function onRequest(context) {
  const { request, env, next } = context;
  const response = await next();

  const tool = toolFromRequest(request, response);
  if (tool && env?.DB && env?.DEDUP) {
    context.waitUntil(recordHit(env, request, tool).catch(() => {}));
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

async function recordHit(env, request, tool) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  const hour = Math.floor(Date.now() / 3_600_000);
  const token = await sha256(`${ip}|${tool}|${hour}`);

  if (await env.DEDUP.get(token)) return;
  await env.DEDUP.put(token, '1', { expirationTtl: 3600 });

  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(
    `INSERT INTO tool_hits (tool, day, count) VALUES (?, ?, 1)
     ON CONFLICT(tool, day) DO UPDATE SET count = count + 1`,
  ).bind(tool, day).run();
}

async function sha256(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

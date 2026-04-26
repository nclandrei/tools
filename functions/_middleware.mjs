// Records a data point in Cloudflare Analytics Engine for each tool page view.
//
// Single binding: `AE` (analytics_engine_dataset). Fire-and-forget — AE
// queues the write internally, no waitUntil needed. When AE is unbound
// (preview deploys) or the call throws, the middleware silently skips.

const BOT_RE = /bot|crawler|spider|curl|wget|headless|lighthouse|preview|fetch|monitor/i;
const TOOL_PATH_RE = /^\/([a-z][a-z0-9_]*)\.html$/;

export async function onRequest(context) {
  const { request, env, next } = context;
  const response = await next();

  const tool = toolFromRequest(request, response);
  if (tool && env?.AE) {
    try {
      env.AE.writeDataPoint({
        blobs: [tool],
        doubles: [1],
        indexes: [tool],
      });
    } catch {}
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

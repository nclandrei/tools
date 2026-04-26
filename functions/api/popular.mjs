// Returns the most-hit tools over the last 7 days as JSON.
//
// Queries Cloudflare Analytics Engine over its SQL HTTP API. The AE
// dataset is populated by functions/_middleware.mjs via writeDataPoint.
//
// Required env:
//   CF_ACCOUNT_ID  Cloudflare account ID (plain env var)
//   CF_AE_TOKEN    API token with `Account Analytics:Read` (secret)
//
// When either is missing or the call fails, returns `{ tools: [] }` so
// the landing page degrades gracefully.

const QUERY = `
  SELECT blob1 AS tool, SUM(_sample_interval * double1) AS hits
  FROM tool_hits
  WHERE timestamp > NOW() - INTERVAL '7' DAY
  GROUP BY tool
  HAVING hits >= 5
  ORDER BY hits DESC
  LIMIT 8
  FORMAT JSON
`;

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=300',
};

export async function onRequest(context) {
  const tools = await fetchTop(context.env);
  return new Response(JSON.stringify({ tools }), { headers: HEADERS });
}

async function fetchTop(env) {
  if (!env?.CF_ACCOUNT_ID || !env?.CF_AE_TOKEN) return [];
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_AE_TOKEN}` },
      body: QUERY,
    });
    if (!res.ok) return [];
    const json = await res.json();
    if (!Array.isArray(json?.data)) return [];
    return json.data
      .filter((r) => r && typeof r.tool === 'string')
      .map((r) => ({ tool: r.tool, hits: Math.round(Number(r.hits) || 0) }));
  } catch {
    return [];
  }
}

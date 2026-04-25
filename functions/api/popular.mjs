// Returns the most-hit tools over the last 7 days as JSON.
//
// Reads from the `DB` D1 binding (see schema.sql). When the binding is
// missing or the query fails, returns `{ tools: [] }` so the landing
// page can degrade gracefully.

const QUERY = `
  SELECT tool, SUM(count) AS hits
  FROM tool_hits
  WHERE day >= date('now', '-7 days')
  GROUP BY tool
  HAVING hits >= 5
  ORDER BY hits DESC
  LIMIT 8
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
  if (!env?.DB) return [];
  try {
    const { results } = await env.DB.prepare(QUERY).all();
    return results || [];
  } catch {
    return [];
  }
}

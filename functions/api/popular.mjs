// Returns the most-hit tools as JSON.
//
// Reads from the `KV` namespace binding. Each `hits:<tool>` key carries
// its count in metadata, so a single `list()` call is enough — no per-key
// reads. When KV is unbound or the call fails, returns `{ tools: [] }`
// so the landing page degrades gracefully.

const PREFIX = 'hits:';
const MIN_HITS = 5;
const LIMIT = 8;

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=300',
};

export async function onRequest(context) {
  const tools = await fetchTop(context.env);
  return new Response(JSON.stringify({ tools }), { headers: HEADERS });
}

async function fetchTop(env) {
  if (!env?.KV) return [];
  try {
    const { keys } = await env.KV.list({ prefix: PREFIX });
    return keys
      .map((k) => ({ tool: k.name.slice(PREFIX.length), hits: k.metadata?.count ?? 0 }))
      .filter((t) => t.hits >= MIN_HITS)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, LIMIT);
  } catch {
    return [];
  }
}

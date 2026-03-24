const ALLOWED_DOMAINS = [
  'sumodb.sumogames.de',
];

export async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const url = new URL(request.url).searchParams.get('url');

  if (!url) {
    return Response.json({ error: 'Missing "url" query parameter' }, { status: 400 });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return Response.json({ error: 'Invalid URL' }, { status: 400 });
  }

  if (parsed.protocol !== 'https:') {
    return Response.json({ error: 'Only HTTPS URLs are allowed' }, { status: 403 });
  }

  if (!ALLOWED_DOMAINS.includes(parsed.hostname)) {
    return Response.json({ error: `Domain "${parsed.hostname}" is not allowed` }, { status: 403 });
  }

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'ToolsProxy/1.0' },
    });

    const body = await resp.text();

    return new Response(body, {
      status: resp.status,
      headers: {
        'Content-Type': resp.headers.get('Content-Type') || 'text/html',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return Response.json({ error: `Upstream fetch failed: ${err.message}` }, { status: 502 });
  }
}

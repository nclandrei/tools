export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get('url');

  if (!target) {
    return new Response('Missing "url" query parameter', { status: 400 });
  }

  // Only allow proxying to sumodb
  const parsed = new URL(target);
  if (parsed.hostname !== 'sumodb.sumogames.de') {
    return new Response('Forbidden: only sumodb.sumogames.de is allowed', { status: 403 });
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  try {
    const res = await fetch(target, {
      headers: { 'User-Agent': 'tools.nicolaeandrei.com proxy' },
    });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        ...headers,
        'Content-Type': res.headers.get('Content-Type') || 'text/html',
      },
    });
  } catch (err) {
    return new Response(`Proxy error: ${err.message}`, { status: 502, headers });
  }
}

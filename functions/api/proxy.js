const ALLOWED_DOMAINS = [
  'sumodb.sumogames.de',
  'www.youtube.com',
  'youtube.com',
  'substack.com',
  'www.substack.com',
];

// Patterns for whole groups of allowed domains. Used by the substack tool to
// reach `<publication>.substack.com` subdomains without enumerating every one.
const ALLOWED_DOMAIN_PATTERNS = [
  /^[a-z0-9][a-z0-9-]{0,62}\.substack\.com$/i,
];

// Per-domain User-Agent overrides. YouTube serves a stripped-down page
// (or a consent interstitial with no player response) to unrecognised UAs,
// so we pose as a recent desktop browser for those requests.
const UA_OVERRIDES = {
  'www.youtube.com': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'youtube.com': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

function isAllowedHost(hostname) {
  if (ALLOWED_DOMAINS.includes(hostname)) return true;
  return ALLOWED_DOMAIN_PATTERNS.some((re) => re.test(hostname));
}

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

  if (!isAllowedHost(parsed.hostname)) {
    return Response.json({ error: `Domain "${parsed.hostname}" is not allowed` }, { status: 403 });
  }

  try {
    const userAgent = UA_OVERRIDES[parsed.hostname] || 'ToolsProxy/1.0';
    const resp = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept-Language': 'en-US,en;q=0.9',
      },
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

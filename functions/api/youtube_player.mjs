// Cloudflare Pages Function: /api/youtube_player?v=<videoId>
//
// Calls YouTube's InnerTube /youtubei/v1/player endpoint with an ANDROID
// client context and returns the player response JSON verbatim to the
// browser. This replaces scraping https://www.youtube.com/watch?v=...
// through the generic HTML proxy, which reliably returned HTTP 429 from
// Cloudflare Pages egress IPs — /youtubei is the endpoint the real mobile
// apps use and tolerates server-side traffic much more gracefully.
//
// The returned JSON has the same shape the watch page used to expose via
// `ytInitialPlayerResponse`, so the frontend can continue to read
// `videoDetails`, `playabilityStatus`, and
// `captions.playerCaptionsTracklistRenderer.captionTracks` unchanged.

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// Public InnerTube API key shipped with the YouTube Android app. Not a
// secret — it only gates the public /youtubei endpoints and is baked into
// every install of the mobile client.
const INNERTUBE_KEY = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';
const CLIENT_VERSION = '19.09.37';
const ANDROID_USER_AGENT =
  'com.google.android.youtube/19.09.37 (Linux; U; Android 14) gzip';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const videoId = new URL(request.url).searchParams.get('v');
  if (!videoId) {
    return json({ error: 'Missing "v" (video id) query parameter' }, 400);
  }
  if (!VIDEO_ID_RE.test(videoId)) {
    return json({ error: 'Invalid YouTube video id' }, 400);
  }

  const payload = {
    videoId,
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: CLIENT_VERSION,
        androidSdkVersion: 34,
        hl: 'en',
        gl: 'US',
        userAgent: ANDROID_USER_AGENT,
      },
    },
  };

  const upstreamUrl =
    'https://www.youtube.com/youtubei/v1/player' +
    '?key=' + INNERTUBE_KEY +
    '&prettyPrint=false';

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': ANDROID_USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': CLIENT_VERSION,
        Origin: 'https://www.youtube.com',
        Referer: 'https://www.youtube.com/',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return json({ error: `Upstream fetch failed: ${err.message}` }, 502);
  }

  const text = await upstream.text();

  if (!upstream.ok) {
    const reason =
      upstream.status === 429
        ? 'YouTube rate-limited the request (HTTP 429). Try again in a moment.'
        : `YouTube returned HTTP ${upstream.status}.`;
    return json({ error: reason }, upstream.status);
  }

  return new Response(text, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

// Cloudflare Pages Function: /api/youtube_player?v=<videoId>
//
// Returns a YouTube player-response-shaped JSON whose layout matches what
// the frontend already reads — `videoDetails`, `playabilityStatus`, and
// `captions.playerCaptionsTracklistRenderer.captionTracks`.
//
// Background: YouTube's InnerTube `/youtubei/v1/player` endpoint and the
// HTML watch page are both behind a "Sign in to confirm you're not a bot"
// wall when called from datacenter IPs (including Cloudflare Pages
// egress). Every InnerTube client we cycled through — ANDROID_VR,
// TVHTML5_SIMPLY_EMBEDDED_PLAYER, MWEB, etc. — eventually got gated.
//
// This module skips InnerTube entirely and uses two of YouTube's older,
// non-bot-gated endpoints:
//
//   1. oEmbed (`/oembed?format=json&url=...`) for video metadata
//      (title, author, thumbnail). Returns 401 for private/removed
//      videos and 404 for unknown ids — those map to a synthesised
//      `playabilityStatus` error so the frontend can render its
//      existing "Video unavailable" banner.
//
//   2. timedtext list (`/api/timedtext?type=list&v=<id>`) for the set
//      of caption tracks. Returns XML enumerating user-uploaded tracks
//      (lang_code, name, lang_translated). For each track we synthesise
//      a srv1-format baseUrl pointing back at /api/timedtext, which the
//      frontend then fetches via its existing /api/proxy whitelist.
//
// Tradeoff: the timedtext list endpoint only enumerates user-authored
// captions, not auto-generated (ASR) ones. Videos with only ASR tracks
// will surface as "no captions found". This is the deliberate cost of
// avoiding InnerTube's bot-check.

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// Standard desktop UA. oEmbed and timedtext are public endpoints, but
// YouTube still serves stripped responses to obviously-bot UAs.
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

function unavailableResponse(reason) {
  return {
    playabilityStatus: { status: 'ERROR', reason },
    videoDetails: {},
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
  };
}

async function fetchOembed(videoId) {
  const target =
    'https://www.youtube.com/oembed?format=json&url=' +
    encodeURIComponent('https://www.youtube.com/watch?v=' + videoId);
  const r = await fetch(target, {
    headers: {
      'User-Agent': DESKTOP_UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (r.status === 401) {
    return { ok: false, reason: 'Private video or sign-in required.' };
  }
  if (r.status === 404) {
    return { ok: false, reason: 'Video not found.' };
  }
  if (!r.ok) {
    return { ok: false, reason: 'YouTube oEmbed returned HTTP ' + r.status + '.' };
  }
  let body;
  try {
    body = await r.json();
  } catch {
    return { ok: false, reason: 'YouTube oEmbed returned an unparseable response.' };
  }
  return {
    ok: true,
    title: typeof body.title === 'string' ? body.title : '',
    author: typeof body.author_name === 'string' ? body.author_name : '',
    thumbnail: typeof body.thumbnail_url === 'string' ? body.thumbnail_url : '',
  };
}

// Pull every <track .../> element's attribute bag out of the timedtext
// list XML. The schema is shallow (single <transcript_list> root, flat
// <track ... /> children), so a regex over self-closing tags is enough
// and avoids dragging in an XML parser.
function parseTimedtextList(xml) {
  const tracks = [];
  const trackRe = /<track\b([^>]*?)\/?>/g;
  let m;
  while ((m = trackRe.exec(xml)) !== null) {
    const attrs = {};
    const attrRe = /(\w+)="([^"]*)"/g;
    let a;
    while ((a = attrRe.exec(m[1])) !== null) {
      attrs[a[1]] = a[2];
    }
    if (attrs.lang_code) tracks.push(attrs);
  }
  return tracks;
}

async function fetchTimedtextList(videoId) {
  const target =
    'https://www.youtube.com/api/timedtext?type=list&v=' +
    encodeURIComponent(videoId);
  const r = await fetch(target, {
    headers: {
      'User-Agent': DESKTOP_UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!r.ok) {
    return { ok: false, reason: 'Caption list returned HTTP ' + r.status + '.' };
  }
  const xml = await r.text();
  return { ok: true, tracks: parseTimedtextList(xml) };
}

// Decode HTML/XML entities that show up in lang_translated / name
// attributes (e.g. &amp;, &#39;). The values came from XML attributes
// so the set is small.
function decodeXmlEntity(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, ent) => {
    if (ent === 'amp') return '&';
    if (ent === 'lt') return '<';
    if (ent === 'gt') return '>';
    if (ent === 'quot') return '"';
    if (ent === 'apos') return "'";
    if (ent[0] === '#') {
      const code =
        ent[1] === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return m;
  });
}

function trackLabel(attrs) {
  const lang = decodeXmlEntity(attrs.lang_translated || attrs.lang_original || attrs.lang_code || '');
  const name = decodeXmlEntity(attrs.name || '');
  if (name && lang) return lang + ' — ' + name;
  return name || lang || attrs.lang_code || 'Track';
}

function buildCaptionTrack(videoId, attrs) {
  const params = new URLSearchParams();
  params.set('v', videoId);
  params.set('lang', attrs.lang_code);
  if (attrs.name) params.set('name', attrs.name);
  params.set('fmt', 'srv1');
  return {
    baseUrl: 'https://www.youtube.com/api/timedtext?' + params.toString(),
    name: { simpleText: trackLabel(attrs) },
    languageCode: attrs.lang_code,
    // timedtext list never enumerates ASR tracks, so leave kind unset.
  };
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

  let oembed;
  try {
    oembed = await fetchOembed(videoId);
  } catch (err) {
    oembed = { ok: false, reason: 'oEmbed fetch failed: ' + err.message };
  }
  if (!oembed.ok) {
    return json(unavailableResponse(oembed.reason));
  }

  let listResult;
  try {
    listResult = await fetchTimedtextList(videoId);
  } catch (err) {
    listResult = { ok: false, reason: 'Caption list fetch failed: ' + err.message };
  }

  const captionTracks =
    listResult.ok && Array.isArray(listResult.tracks)
      ? listResult.tracks.map((t) => buildCaptionTrack(videoId, t))
      : [];

  return json({
    playabilityStatus: { status: 'OK' },
    videoDetails: {
      videoId,
      title: oembed.title,
      author: oembed.author,
      thumbnail: oembed.thumbnail,
    },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks,
      },
    },
  });
}

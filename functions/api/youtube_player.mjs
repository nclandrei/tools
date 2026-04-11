// Cloudflare Pages Function: /api/youtube_player?v=<videoId>
//
// Returns a YouTube player response JSON whose shape matches what the
// watch page used to expose via `ytInitialPlayerResponse` — the frontend
// reads `videoDetails`, `playabilityStatus`, and
// `captions.playerCaptionsTracklistRenderer.captionTracks` unchanged.
//
// YouTube tightened its anti-bot gates in late 2024 / early 2025. The
// previous approach — POSTing to /youtubei/v1/player with an ANDROID
// client context — now reliably returns HTTP 400 FAILED_PRECONDITION
// because ANDROID/IOS/WEB clients require a PO token (attestation)
// server-side clients cannot mint. This module tries two fallbacks that
// still work unauthenticated:
//
//   1. InnerTube with the ANDROID_VR (Meta Quest) client — it's on the
//      short list of clients yt-dlp/community reports as not gated
//      behind PO tokens. Works cleanly for many videos but some return
//      LOGIN_REQUIRED / UNPLAYABLE.
//   2. Scrape https://www.youtube.com/watch?v=... and extract
//      `ytInitialPlayerResponse` from the HTML. This is the original
//      approach; it intermittently gets HTTP 429 from Pages egress IPs
//      but fills in the gap for videos ANDROID_VR refuses.
//
// We pick whichever response is "best": an OK playability status with
// caption tracks wins; otherwise we return the first non-empty result so
// the frontend can surface a meaningful error (LOGIN_REQUIRED, UNPLAYABLE,
// "no captions", etc.).

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// ANDROID_VR (Meta Quest YouTube app). clientName=28.
const ANDROID_VR_CLIENT_VERSION = '1.60.19';
const ANDROID_VR_USER_AGENT =
  'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip';

// Desktop Chrome UA for the watch-page scrape fallback. YouTube serves a
// stripped-down "please update your browser" page to unrecognised UAs.
const DESKTOP_CHROME_UA =
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

// Returns true if the player response has at least one caption track and
// the video is actually playable.
function isGoodPlayerResponse(data) {
  if (!data || typeof data !== 'object') return false;
  const status = data.playabilityStatus?.status;
  if (status && status !== 'OK') return false;
  const tracks =
    data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) && tracks.length > 0;
}

async function fetchViaAndroidVr(videoId) {
  const payload = {
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
    context: {
      client: {
        clientName: 'ANDROID_VR',
        clientVersion: ANDROID_VR_CLIENT_VERSION,
        deviceMake: 'Oculus',
        deviceModel: 'Quest 3',
        osName: 'Android',
        osVersion: '12L',
        androidSdkVersion: 32,
        platform: 'MOBILE',
        hl: 'en',
        gl: 'US',
        userAgent: ANDROID_VR_USER_AGENT,
      },
    },
  };

  const upstreamUrl =
    'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

  const upstream = await fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': ANDROID_VR_USER_AGENT,
      'X-YouTube-Client-Name': '28',
      'X-YouTube-Client-Version': ANDROID_VR_CLIENT_VERSION,
      Origin: 'https://www.youtube.com',
      Referer: 'https://www.youtube.com/',
    },
    body: JSON.stringify(payload),
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    return { ok: false, status: upstream.status, data: null };
  }
  try {
    return { ok: true, status: 200, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: 502, data: null };
  }
}

// Slice a JSON object out of a string starting at `from`, honouring
// nested braces and string literals. Returns the JSON text or null.
function sliceBalancedJson(src, from) {
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (escape) {
        escape = false;
      } else if (c === '\\') {
        escape = true;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  return null;
}

function extractPlayerResponseFromHtml(html) {
  // ytInitialPlayerResponse = {...};
  const marker = 'ytInitialPlayerResponse';
  let i = 0;
  while (i < html.length) {
    const found = html.indexOf(marker, i);
    if (found < 0) return null;
    // Walk forward to the first '{' after the marker. Tolerate an '='
    // or ':' separator and surrounding whitespace.
    let j = found + marker.length;
    while (j < html.length && html[j] !== '{' && html[j] !== '<') j++;
    if (html[j] === '{') {
      const blob = sliceBalancedJson(html, j);
      if (blob && blob.length > 100) {
        try {
          return JSON.parse(blob);
        } catch {
          // keep searching for another occurrence
        }
      }
    }
    i = found + marker.length;
  }
  return null;
}

async function fetchViaWatchPageScrape(videoId) {
  const watchUrl =
    'https://www.youtube.com/watch?v=' +
    encodeURIComponent(videoId) +
    // bpctr bypasses age-restriction interstitials
    '&bpctr=9999999999&has_verified=1';

  const upstream = await fetch(watchUrl, {
    headers: {
      'User-Agent': DESKTOP_CHROME_UA,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      // The consent cookie dodges the EU consent interstitial which
      // otherwise replaces the player response with a consent form.
      Cookie:
        'CONSENT=YES+; SOCS=CAISEwgDEgk0NzE5ODk2MzgaAmVuIAEaBgiAq_rDBg',
    },
    redirect: 'follow',
  });

  if (!upstream.ok) {
    return { ok: false, status: upstream.status, data: null };
  }

  const html = await upstream.text();
  const data = extractPlayerResponseFromHtml(html);
  if (!data) {
    return { ok: false, status: 502, data: null };
  }
  return { ok: true, status: 200, data };
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

  const attempts = [];

  // ── Attempt 1: ANDROID_VR InnerTube ────────────────────────────────
  try {
    const r = await fetchViaAndroidVr(videoId);
    if (r.ok && r.data) {
      if (isGoodPlayerResponse(r.data)) return json(r.data);
      attempts.push(r.data);
    } else if (r.status === 429) {
      attempts.push({
        __err:
          'YouTube rate-limited the request (HTTP 429). Try again in a moment.',
      });
    } else if (r.status) {
      attempts.push({ __err: `InnerTube returned HTTP ${r.status}.` });
    }
  } catch (err) {
    attempts.push({ __err: `InnerTube fetch failed: ${err.message}` });
  }

  // ── Attempt 2: watch page scrape ───────────────────────────────────
  try {
    const r = await fetchViaWatchPageScrape(videoId);
    if (r.ok && r.data) {
      if (isGoodPlayerResponse(r.data)) return json(r.data);
      attempts.push(r.data);
    } else if (r.status === 429) {
      attempts.push({
        __err:
          'YouTube rate-limited the request (HTTP 429). Try again in a moment.',
      });
    } else if (r.status) {
      attempts.push({ __err: `Watch page returned HTTP ${r.status}.` });
    }
  } catch (err) {
    attempts.push({ __err: `Watch page fetch failed: ${err.message}` });
  }

  // Neither attempt produced a playable+captioned response. Pick the
  // first attempt that has a real player-response shape so the frontend
  // can render a useful error (LOGIN_REQUIRED, UNPLAYABLE, "no
  // captions", age-restricted, etc.) rather than a bare HTTP code.
  const firstPlayerShaped = attempts.find(
    (a) => a && typeof a === 'object' && !a.__err && a.playabilityStatus
  );
  if (firstPlayerShaped) return json(firstPlayerShaped);

  const firstErr = attempts.find((a) => a && a.__err);
  const errMsg =
    (firstErr && firstErr.__err) ||
    'YouTube did not return a usable player response.';
  return json({ error: errMsg }, 502);
}

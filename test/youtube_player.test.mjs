// Tests for functions/api/youtube_player.mjs.
//
// Run with: node --test test/youtube_player.test.mjs
//
// The module reads `globalThis.fetch`, so each test installs its own
// fetch mock and inspects which upstream YouTube endpoints it calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/youtube_player.mjs';

const VIDEO_ID = '_Qyv9iLjnfU';

const LOGIN_REQUIRED_BODY = {
  playabilityStatus: {
    status: 'LOGIN_REQUIRED',
    reason: "Sign in to confirm you're not a bot",
  },
};

function goodPlayerResponse(label) {
  return {
    playabilityStatus: { status: 'OK' },
    videoDetails: { title: 'Test ' + label, author: 'Tester' },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            baseUrl: 'https://www.youtube.com/api/timedtext?v=' + VIDEO_ID,
            languageCode: 'en',
            kind: 'asr',
          },
        ],
      },
    },
  };
}

function makeContext(videoId = VIDEO_ID) {
  return {
    request: new Request(
      'https://example.com/api/youtube_player?v=' + videoId,
    ),
  };
}

function installFetchMock(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return handler(String(url), opts);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function clientNameOf(opts) {
  const headers = opts?.headers || {};
  return headers['X-YouTube-Client-Name'] || headers['x-youtube-client-name'];
}

test('falls back to a third client when ANDROID_VR and watch-page scrape both hit the bot-check', async () => {
  // Real-world repro: YouTube returned LOGIN_REQUIRED ("Sign in to
  // confirm you're not a bot") for both ANDROID_VR (clientName=28) and
  // the desktop watch-page scrape. The module should keep trying
  // alternative InnerTube clients before giving up.
  const mock = installFetchMock(async (url, opts) => {
    if (url.includes('/youtubei/v1/player')) {
      const client = clientNameOf(opts);
      if (client === '28') {
        // ANDROID_VR is bot-checked.
        return new Response(JSON.stringify(LOGIN_REQUIRED_BODY), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Any other InnerTube client succeeds.
      return new Response(JSON.stringify(goodPlayerResponse(client)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('https://www.youtube.com/watch')) {
      // Watch-page scrape is also bot-checked.
      const html =
        '<html><script>var ytInitialPlayerResponse = ' +
        JSON.stringify(LOGIN_REQUIRED_BODY) +
        ';</script></html>';
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }
    throw new Error('Unexpected fetch: ' + url);
  });

  try {
    const res = await onRequest(makeContext());
    assert.equal(res.status, 200, 'expected 200 response');
    const data = await res.json();
    assert.equal(
      data.playabilityStatus?.status,
      'OK',
      'expected playabilityStatus.status === "OK" after fallback',
    );
    const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    assert.ok(
      Array.isArray(tracks) && tracks.length > 0,
      'expected non-empty caption tracks after fallback',
    );

    // Sanity: the module must have actually attempted a non-ANDROID_VR
    // InnerTube client (otherwise it could not have produced a good
    // response with the mock above).
    const innertubeClients = mock.calls
      .filter((c) => c.url.includes('/youtubei/v1/player'))
      .map((c) => clientNameOf(c.opts));
    assert.ok(
      innertubeClients.some((c) => c && c !== '28'),
      'expected the module to try at least one InnerTube client other than ANDROID_VR (28); saw: ' +
        JSON.stringify(innertubeClients),
    );
  } finally {
    mock.restore();
  }
});

test('returns a good ANDROID_VR response without falling back', async () => {
  // Sanity check: the happy path still short-circuits on the first
  // good response.
  const mock = installFetchMock(async (url, opts) => {
    if (url.includes('/youtubei/v1/player')) {
      return new Response(JSON.stringify(goodPlayerResponse('ANDROID_VR')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error('Unexpected fetch: ' + url);
  });

  try {
    const res = await onRequest(makeContext());
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.playabilityStatus.status, 'OK');
    // Only one upstream call (the first client) — no fallbacks.
    assert.equal(mock.calls.length, 1);
  } finally {
    mock.restore();
  }
});

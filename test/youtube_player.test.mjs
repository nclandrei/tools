// Tests for functions/api/youtube_player.mjs.
//
// Run with: node --test test/youtube_player.test.mjs
//
// The module reads `globalThis.fetch`, so each test installs its own
// fetch mock and inspects which upstream YouTube endpoints it calls.
//
// Strategy: the module fetches video metadata via YouTube's `oembed`
// endpoint (no auth, no bot-check) and enumerates caption tracks via
// `/api/timedtext?type=list&v=<id>` (returns XML). It then synthesises
// a player-response-shaped JSON so the frontend stays unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/youtube_player.mjs';

const VIDEO_ID = '_Qyv9iLjnfU';

const OEMBED_OK_BODY = {
  title: 'Test Video Title',
  author_name: 'Test Channel',
  author_url: 'https://www.youtube.com/@TestChannel',
  thumbnail_url: 'https://i.ytimg.com/vi/' + VIDEO_ID + '/hqdefault.jpg',
};

const TIMEDTEXT_LIST_OK = `<?xml version="1.0" encoding="utf-8" ?>
<transcript_list docid="abc">
  <track id="0" name="" lang_code="en" lang_original="English" lang_translated="English" lang_default="true"/>
  <track id="1" name="CC1" lang_code="en" lang_original="English" lang_translated="English"/>
  <track id="2" name="" lang_code="es" lang_original="español" lang_translated="Spanish"/>
</transcript_list>`;

const TIMEDTEXT_LIST_EMPTY = `<?xml version="1.0" encoding="utf-8" ?>
<transcript_list docid="abc"></transcript_list>`;

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

function isOembedUrl(url) {
  return url.startsWith('https://www.youtube.com/oembed');
}

function isTimedtextListUrl(url) {
  return (
    url.startsWith('https://www.youtube.com/api/timedtext') &&
    /[?&]type=list(&|$)/.test(url)
  );
}

test('rejects missing or invalid video id', async () => {
  const mock = installFetchMock(async () => {
    throw new Error('should not be called');
  });
  try {
    let res = await onRequest({
      request: new Request('https://example.com/api/youtube_player'),
    });
    assert.equal(res.status, 400);

    res = await onRequest({
      request: new Request('https://example.com/api/youtube_player?v=tooShort'),
    });
    assert.equal(res.status, 400);

    res = await onRequest({
      request: new Request('https://example.com/api/youtube_player?v=has spaces!'),
    });
    assert.equal(res.status, 400);

    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test('happy path: oembed + timedtext list synthesises player response shape', async () => {
  const mock = installFetchMock(async (url) => {
    if (isOembedUrl(url)) {
      return new Response(JSON.stringify(OEMBED_OK_BODY), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (isTimedtextListUrl(url)) {
      return new Response(TIMEDTEXT_LIST_OK, {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      });
    }
    throw new Error('Unexpected fetch: ' + url);
  });

  try {
    const res = await onRequest(makeContext());
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.playabilityStatus.status, 'OK');
    assert.equal(data.videoDetails.title, 'Test Video Title');
    assert.equal(data.videoDetails.author, 'Test Channel');
    assert.equal(data.videoDetails.videoId, VIDEO_ID);

    const tracks = data.captions.playerCaptionsTracklistRenderer.captionTracks;
    assert.equal(tracks.length, 3);

    // First track: default English, no `name` attribute
    assert.equal(tracks[0].languageCode, 'en');
    assert.ok(
      tracks[0].baseUrl.includes('lang=en'),
      'expected baseUrl to include lang=en, got: ' + tracks[0].baseUrl,
    );
    assert.ok(
      tracks[0].baseUrl.includes('v=' + VIDEO_ID),
      'expected baseUrl to include v=' + VIDEO_ID,
    );
    assert.ok(
      tracks[0].baseUrl.includes('fmt=srv1'),
      'expected baseUrl to request srv1 XML format',
    );
    assert.ok(
      !/[?&]name=/.test(tracks[0].baseUrl),
      'default track should not have a name= param, got: ' + tracks[0].baseUrl,
    );

    // Second track: named "CC1" — must round-trip into baseUrl
    assert.equal(tracks[1].languageCode, 'en');
    assert.ok(
      /[?&]name=CC1(&|$)/.test(tracks[1].baseUrl),
      'expected baseUrl to include name=CC1, got: ' + tracks[1].baseUrl,
    );

    // Third track: Spanish
    assert.equal(tracks[2].languageCode, 'es');
    assert.ok(tracks[2].baseUrl.includes('lang=es'));

    // Sanity: no InnerTube call should have been made.
    const innertubeCalls = mock.calls.filter((c) =>
      c.url.includes('/youtubei/v1/player'),
    );
    assert.equal(innertubeCalls.length, 0);
  } finally {
    mock.restore();
  }
});

test('caption track names are exposed in player-response simpleText shape', async () => {
  // The frontend reads either `track.name.simpleText` or
  // `track.name.runs[].text`. The synthesised response must populate one
  // of those; otherwise the language picker shows blank entries.
  const mock = installFetchMock(async (url) => {
    if (isOembedUrl(url)) {
      return new Response(JSON.stringify(OEMBED_OK_BODY), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (isTimedtextListUrl(url)) {
      return new Response(TIMEDTEXT_LIST_OK, {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      });
    }
    throw new Error('Unexpected fetch: ' + url);
  });

  try {
    const res = await onRequest(makeContext());
    const data = await res.json();
    const tracks = data.captions.playerCaptionsTracklistRenderer.captionTracks;

    // Each track must surface a human-readable label.
    for (const t of tracks) {
      const label =
        t.name?.simpleText ||
        t.name?.runs?.map((r) => r.text).join('') ||
        '';
      assert.ok(label.length > 0, 'expected non-empty label for ' + JSON.stringify(t));
    }

    // The named "CC1" track must surface "CC1" somewhere in its label.
    assert.ok(
      tracks[1].name?.simpleText?.includes('CC1') ||
        tracks[1].name?.runs?.some((r) => r.text.includes('CC1')),
      'expected named track label to contain "CC1"',
    );
  } finally {
    mock.restore();
  }
});

test('empty transcript list returns OK status with empty captionTracks', async () => {
  // Video exists (oembed returns metadata) but uploader didn't publish
  // any user-authored captions. Frontend renders the "no captions" hint.
  const mock = installFetchMock(async (url) => {
    if (isOembedUrl(url)) {
      return new Response(JSON.stringify(OEMBED_OK_BODY), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (isTimedtextListUrl(url)) {
      return new Response(TIMEDTEXT_LIST_EMPTY, {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      });
    }
    throw new Error('Unexpected fetch: ' + url);
  });

  try {
    const res = await onRequest(makeContext());
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.playabilityStatus.status, 'OK');
    const tracks = data.captions.playerCaptionsTracklistRenderer.captionTracks;
    assert.deepEqual(tracks, []);
  } finally {
    mock.restore();
  }
});

test('video unavailable: oembed 401 surfaces a player-shaped error', async () => {
  // Private / removed videos: oembed returns 401 ("Unauthorized"). The
  // frontend reads `playabilityStatus.status` and `.reason`, so the
  // module must populate those instead of returning a bare HTTP error.
  const mock = installFetchMock(async (url) => {
    if (isOembedUrl(url)) {
      return new Response('Unauthorized', { status: 401 });
    }
    throw new Error('Unexpected fetch: ' + url);
  });

  try {
    const res = await onRequest(makeContext());
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.notEqual(data.playabilityStatus.status, 'OK');
    assert.ok(
      typeof data.playabilityStatus.reason === 'string' &&
        data.playabilityStatus.reason.length > 0,
      'expected a non-empty reason string',
    );
  } finally {
    mock.restore();
  }
});

test('video not found: oembed 404 surfaces a player-shaped error', async () => {
  const mock = installFetchMock(async (url) => {
    if (isOembedUrl(url)) {
      return new Response('Not Found', { status: 404 });
    }
    throw new Error('Unexpected fetch: ' + url);
  });

  try {
    const res = await onRequest(makeContext());
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.notEqual(data.playabilityStatus.status, 'OK');
  } finally {
    mock.restore();
  }
});

test('does not call the bot-checked InnerTube /player endpoint', async () => {
  // Regression guard: the whole point of switching to oembed+timedtext
  // is to stop touching the InnerTube /player endpoint that returns
  // "Sign in to confirm you're not a bot" from Pages egress IPs.
  const mock = installFetchMock(async (url) => {
    if (isOembedUrl(url)) {
      return new Response(JSON.stringify(OEMBED_OK_BODY), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (isTimedtextListUrl(url)) {
      return new Response(TIMEDTEXT_LIST_OK, {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      });
    }
    throw new Error('Unexpected fetch: ' + url);
  });

  try {
    await onRequest(makeContext());
    const innertubeCalls = mock.calls.filter((c) =>
      c.url.includes('/youtubei/v1/player'),
    );
    assert.equal(
      innertubeCalls.length,
      0,
      'must not hit /youtubei/v1/player anymore',
    );
    const watchPageCalls = mock.calls.filter(
      (c) =>
        c.url.startsWith('https://www.youtube.com/watch') ||
        c.url.startsWith('https://m.youtube.com/watch'),
    );
    assert.equal(
      watchPageCalls.length,
      0,
      'must not scrape the bot-checked watch page anymore',
    );
  } finally {
    mock.restore();
  }
});

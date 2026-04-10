// Tests for the /api/youtube_player Cloudflare Pages Function.
//
// The transcript extractor used to scrape https://www.youtube.com/watch?v=...
// through a generic HTML proxy, which started returning HTTP 429 reliably
// from Cloudflare Pages egress IPs. The fix is to call YouTube's InnerTube
// /youtubei/v1/player endpoint with an ANDROID client context instead — the
// same path the YouTube mobile apps use, which tolerates server-side traffic
// far better.
//
// Run with: node --test tests/youtube_player.test.mjs

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { onRequest } from '../functions/api/youtube_player.mjs';

describe('youtube_player endpoint', () => {
  const origFetch = globalThis.fetch;
  let fetchCalls;

  beforeEach(() => {
    fetchCalls = [];
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test('rejects request without a video id', async () => {
    const req = new Request('https://example.com/api/youtube_player');
    const res = await onRequest({ request: req });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /video id|"v"/i);
  });

  test('rejects malformed video id', async () => {
    const req = new Request('https://example.com/api/youtube_player?v=not-a-real-id');
    const res = await onRequest({ request: req });
    assert.equal(res.status, 400);
  });

  test('POSTs to InnerTube player endpoint with ANDROID client context', async () => {
    const mockPlayer = {
      playabilityStatus: { status: 'OK' },
      videoDetails: { title: 'Hello', author: 'Alice', videoId: 'abcdefghijk' },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en',
              languageCode: 'en',
              name: { simpleText: 'English' },
            },
          ],
        },
      },
    };
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url: String(url), opts });
      return new Response(JSON.stringify(mockPlayer), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const req = new Request('https://example.com/api/youtube_player?v=abcdefghijk');
    const res = await onRequest({ request: req });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.videoDetails.videoId, 'abcdefghijk');
    assert.equal(body.captions.playerCaptionsTracklistRenderer.captionTracks.length, 1);

    // Verify the outbound request looked like an ANDROID InnerTube call.
    assert.equal(fetchCalls.length, 1);
    const call = fetchCalls[0];
    assert.match(call.url, /^https:\/\/www\.youtube\.com\/youtubei\/v1\/player(\?|$)/);
    assert.equal(call.opts.method, 'POST');

    const headers = call.opts.headers || {};
    const ct = headers['Content-Type'] || headers['content-type'];
    assert.match(ct, /application\/json/i);

    const reqBody = JSON.parse(call.opts.body);
    assert.equal(reqBody.videoId, 'abcdefghijk');
    assert.equal(reqBody.context.client.clientName, 'ANDROID');
    assert.ok(reqBody.context.client.clientVersion, 'clientVersion should be set');
  });

  test('forwards upstream 429 as a JSON error response', async () => {
    globalThis.fetch = async () =>
      new Response('Too Many Requests', { status: 429 });

    const req = new Request('https://example.com/api/youtube_player?v=abcdefghijk');
    const res = await onRequest({ request: req });
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.match(body.error, /429|rate/i);
  });

  test('returns 502 when the upstream fetch throws', async () => {
    globalThis.fetch = async () => {
      throw new Error('network down');
    };

    const req = new Request('https://example.com/api/youtube_player?v=abcdefghijk');
    const res = await onRequest({ request: req });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.match(body.error, /network down/);
  });
});

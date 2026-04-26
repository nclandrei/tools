// Tests for functions/_middleware.mjs.
//
// Run with: node --test test/middleware.test.mjs
//
// The middleware should:
//   - call AE.writeDataPoint with the tool slug for normal tool-page GETs
//   - skip bots, prefetches, non-GET, non-200, non-HTML, /, and asset paths
//   - never throw if the AE binding is missing or writeDataPoint throws
//   - always return the downstream response unchanged

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.mjs';

function makeAE({ throws = false } = {}) {
  const writes = [];
  return {
    writeDataPoint(point) {
      if (throws) throw new Error('boom');
      writes.push(point);
    },
    _writes: writes,
  };
}

function makeContext({
  url = 'https://tools.example.com/jq_visualizer.html',
  method = 'GET',
  headers = {},
  responseStatus = 200,
  responseHeaders = { 'content-type': 'text/html; charset=utf-8' },
  env,
} = {}) {
  if (env === undefined) env = { AE: makeAE() };
  const request = new Request(url, { method, headers });
  return {
    request,
    env,
    next: async () => new Response('<!doctype html>', {
      status: responseStatus,
      headers: responseHeaders,
    }),
  };
}

test('writes a data point with the tool slug for a normal GET', async () => {
  const ctx = makeContext({ headers: { 'user-agent': 'Mozilla/5.0' } });
  const res = await onRequest(ctx);

  assert.equal(res.status, 200);
  assert.equal(ctx.env.AE._writes.length, 1);
  const point = ctx.env.AE._writes[0];
  assert.deepEqual(point.blobs, ['jq_visualizer']);
  assert.deepEqual(point.doubles, [1]);
  assert.deepEqual(point.indexes, ['jq_visualizer']);
});

test('skips known bot user agents', async () => {
  for (const ua of ['Googlebot/2.1', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'curl/7.79.1', 'HeadlessChrome/120']) {
    const ctx = makeContext({ headers: { 'user-agent': ua } });
    await onRequest(ctx);
    assert.equal(ctx.env.AE._writes.length, 0, `expected no write for UA: ${ua}`);
  }
});

test('skips prefetch requests', async () => {
  const ctx = makeContext({
    headers: { 'user-agent': 'Mozilla/5.0', 'sec-purpose': 'prefetch' },
  });
  await onRequest(ctx);
  assert.equal(ctx.env.AE._writes.length, 0);
});

test('skips non-GET requests', async () => {
  const ctx = makeContext({ method: 'POST', headers: { 'user-agent': 'Mozilla/5.0' } });
  await onRequest(ctx);
  assert.equal(ctx.env.AE._writes.length, 0);
});

test('skips the landing page', async () => {
  const ctx = makeContext({ url: 'https://tools.example.com/', headers: { 'user-agent': 'Mozilla/5.0' } });
  await onRequest(ctx);
  assert.equal(ctx.env.AE._writes.length, 0);
});

test('skips non-html paths', async () => {
  const ctx = makeContext({ url: 'https://tools.example.com/theme.css', headers: { 'user-agent': 'Mozilla/5.0' } });
  await onRequest(ctx);
  assert.equal(ctx.env.AE._writes.length, 0);
});

test('skips non-200 responses', async () => {
  const ctx = makeContext({ responseStatus: 404, headers: { 'user-agent': 'Mozilla/5.0' } });
  await onRequest(ctx);
  assert.equal(ctx.env.AE._writes.length, 0);
});

test('skips non-html content types', async () => {
  const ctx = makeContext({
    responseHeaders: { 'content-type': 'application/json' },
    headers: { 'user-agent': 'Mozilla/5.0' },
  });
  await onRequest(ctx);
  assert.equal(ctx.env.AE._writes.length, 0);
});

test('does not throw when AE binding is missing', async () => {
  const ctx = makeContext({ env: {}, headers: { 'user-agent': 'Mozilla/5.0' } });
  const res = await onRequest(ctx);
  assert.equal(res.status, 200);
});

test('does not throw if writeDataPoint throws', async () => {
  const ctx = makeContext({
    env: { AE: makeAE({ throws: true }) },
    headers: { 'user-agent': 'Mozilla/5.0' },
  });
  const res = await onRequest(ctx);
  assert.equal(res.status, 200);
});

test('passes the downstream response through unchanged', async () => {
  const ctx = makeContext({ headers: { 'user-agent': 'Mozilla/5.0' } });
  const res = await onRequest(ctx);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '<!doctype html>');
});

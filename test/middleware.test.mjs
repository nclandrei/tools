// Tests for functions/_middleware.mjs.
//
// Run with: node --test test/middleware.test.mjs
//
// The middleware should:
//   - increment hits:<tool> in KV on a normal GET to /<tool>.html (200 HTML)
//   - skip bots, prefetches, non-GET, non-200, non-HTML, /, and asset paths
//   - dedup by (ip + tool + hour) using a `dedup:<sha>` key with TTL
//   - never throw if the KV binding is missing
//   - always return the downstream response unchanged

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.mjs';

function makeKV() {
  const store = new Map();          // key -> { value, metadata, ttl }
  const puts = [];
  return {
    async get(k) {
      const e = store.get(k);
      return e ? e.value : null;
    },
    async getWithMetadata(k) {
      const e = store.get(k);
      return e ? { value: e.value, metadata: e.metadata ?? null } : { value: null, metadata: null };
    },
    async put(k, v, opts = {}) {
      puts.push({ k, v, opts });
      store.set(k, { value: v, metadata: opts.metadata ?? null, ttl: opts.expirationTtl ?? null });
    },
    _store: store,
    _puts: puts,
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
  if (env === undefined) env = { KV: makeKV() };
  const request = new Request(url, { method, headers });
  const waited = [];
  return {
    request,
    env,
    next: async () => new Response('<!doctype html>', {
      status: responseStatus,
      headers: responseHeaders,
    }),
    waitUntil: (p) => { waited.push(p); },
    _waited: waited,
  };
}

async function flush(ctx) {
  await Promise.all(ctx._waited);
}

test('increments hits:<tool> for a normal GET to a tool page', async () => {
  const ctx = makeContext({
    headers: { 'user-agent': 'Mozilla/5.0', 'cf-connecting-ip': '1.2.3.4' },
  });
  const res = await onRequest(ctx);
  await flush(ctx);

  assert.equal(res.status, 200);
  const hits = await ctx.env.KV.getWithMetadata('hits:jq_visualizer');
  assert.equal(hits.metadata.count, 1);
});

test('subsequent hits from a different IP increment the same key to 2', async () => {
  const env = { KV: makeKV() };
  const c1 = makeContext({ env, headers: { 'user-agent': 'Mozilla/5.0', 'cf-connecting-ip': '1.1.1.1' } });
  await onRequest(c1); await flush(c1);
  const c2 = makeContext({ env, headers: { 'user-agent': 'Mozilla/5.0', 'cf-connecting-ip': '2.2.2.2' } });
  await onRequest(c2); await flush(c2);

  const hits = await env.KV.getWithMetadata('hits:jq_visualizer');
  assert.equal(hits.metadata.count, 2);
});

test('dedups same IP + tool within an hour', async () => {
  const env = { KV: makeKV() };
  const headers = { 'user-agent': 'Mozilla/5.0', 'cf-connecting-ip': '1.2.3.4' };
  const c1 = makeContext({ env, headers });
  await onRequest(c1); await flush(c1);
  const c2 = makeContext({ env, headers });
  await onRequest(c2); await flush(c2);

  const hits = await env.KV.getWithMetadata('hits:jq_visualizer');
  assert.equal(hits.metadata.count, 1, 'second hit from same IP should be deduped');
});

test('writes a dedup key with a 1-hour TTL', async () => {
  const env = { KV: makeKV() };
  const ctx = makeContext({ env, headers: { 'user-agent': 'Mozilla/5.0', 'cf-connecting-ip': '1.2.3.4' } });
  await onRequest(ctx); await flush(ctx);

  const dedupPut = env.KV._puts.find((p) => p.k.startsWith('dedup:'));
  assert.ok(dedupPut, 'expected a dedup:<token> put');
  assert.equal(dedupPut.opts.expirationTtl, 3600);
});

test('skips known bot user agents', async () => {
  for (const ua of ['Googlebot/2.1', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'curl/7.79.1', 'HeadlessChrome/120']) {
    const ctx = makeContext({ headers: { 'user-agent': ua, 'cf-connecting-ip': '1.2.3.4' } });
    await onRequest(ctx); await flush(ctx);
    assert.equal(ctx.env.KV._puts.length, 0, `expected no put for UA: ${ua}`);
  }
});

test('skips prefetch requests', async () => {
  const ctx = makeContext({
    headers: { 'user-agent': 'Mozilla/5.0', 'sec-purpose': 'prefetch', 'cf-connecting-ip': '1.2.3.4' },
  });
  await onRequest(ctx); await flush(ctx);
  assert.equal(ctx.env.KV._puts.length, 0);
});

test('skips non-GET requests', async () => {
  const ctx = makeContext({ method: 'POST', headers: { 'user-agent': 'Mozilla/5.0' } });
  await onRequest(ctx); await flush(ctx);
  assert.equal(ctx.env.KV._puts.length, 0);
});

test('skips the landing page', async () => {
  const ctx = makeContext({ url: 'https://tools.example.com/', headers: { 'user-agent': 'Mozilla/5.0' } });
  await onRequest(ctx); await flush(ctx);
  assert.equal(ctx.env.KV._puts.length, 0);
});

test('skips non-html paths', async () => {
  const ctx = makeContext({ url: 'https://tools.example.com/theme.css', headers: { 'user-agent': 'Mozilla/5.0' } });
  await onRequest(ctx); await flush(ctx);
  assert.equal(ctx.env.KV._puts.length, 0);
});

test('skips non-200 responses', async () => {
  const ctx = makeContext({ responseStatus: 404, headers: { 'user-agent': 'Mozilla/5.0' } });
  await onRequest(ctx); await flush(ctx);
  assert.equal(ctx.env.KV._puts.length, 0);
});

test('skips non-html content types', async () => {
  const ctx = makeContext({
    responseHeaders: { 'content-type': 'application/json' },
    headers: { 'user-agent': 'Mozilla/5.0' },
  });
  await onRequest(ctx); await flush(ctx);
  assert.equal(ctx.env.KV._puts.length, 0);
});

test('does not throw when KV binding is missing', async () => {
  const ctx = makeContext({ env: {}, headers: { 'user-agent': 'Mozilla/5.0' } });
  const res = await onRequest(ctx);
  await flush(ctx);
  assert.equal(res.status, 200);
});

test('passes the downstream response through unchanged', async () => {
  const ctx = makeContext({ headers: { 'user-agent': 'Mozilla/5.0' } });
  const res = await onRequest(ctx);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.equal(body, '<!doctype html>');
});

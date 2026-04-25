// Tests for functions/_middleware.mjs.
//
// Run with: node --test test/middleware.test.mjs
//
// The middleware should:
//   - record a hit for normal GETs to /<tool>.html with a 200 HTML response
//   - skip bots, prefetches, non-GET, non-200, non-HTML, /, and asset paths
//   - dedup by (ip + tool + hour) using KV with TTL
//   - never throw if D1 / KV bindings are missing
//   - always return the downstream response unchanged

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.mjs';

function makeEnv() {
  const dedup = new Map();
  const inserts = [];
  return {
    DEDUP: {
      get: async (k) => (dedup.has(k) ? dedup.get(k) : null),
      put: async (k, v, _opts) => { dedup.set(k, v); },
    },
    DB: {
      prepare(sql) {
        return {
          bind: (...args) => ({
            run: async () => {
              inserts.push({ sql, args });
              return { success: true };
            },
          }),
        };
      },
    },
    _inserts: inserts,
    _dedup: dedup,
  };
}

function makeContext({
  url = 'https://tools.example.com/jq_visualizer.html',
  method = 'GET',
  headers = {},
  responseStatus = 200,
  responseHeaders = { 'content-type': 'text/html; charset=utf-8' },
  env = makeEnv(),
} = {}) {
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
    _env: env,
    _waited: waited,
  };
}

async function flush(ctx) {
  await Promise.all(ctx._waited);
}

test('records a hit for a normal GET to a tool page', async () => {
  const ctx = makeContext({
    headers: {
      'user-agent': 'Mozilla/5.0',
      'cf-connecting-ip': '1.2.3.4',
    },
  });
  const res = await onRequest(ctx);
  await flush(ctx);

  assert.equal(res.status, 200);
  assert.equal(ctx._env._inserts.length, 1);
  const insert = ctx._env._inserts[0];
  assert.match(insert.sql, /INSERT INTO tool_hits/i);
  assert.equal(insert.args[0], 'jq_visualizer');
  assert.match(insert.args[1], /^\d{4}-\d{2}-\d{2}$/);
});

test('dedups same IP + tool within an hour', async () => {
  const env = makeEnv();
  const headers = { 'user-agent': 'Mozilla/5.0', 'cf-connecting-ip': '1.2.3.4' };

  const c1 = makeContext({ env, headers });
  await onRequest(c1); await flush(c1);
  const c2 = makeContext({ env, headers });
  await onRequest(c2); await flush(c2);

  assert.equal(env._inserts.length, 1, 'second hit from same IP should be deduped');
});

test('counts different IPs separately', async () => {
  const env = makeEnv();
  const c1 = makeContext({ env, headers: { 'user-agent': 'Mozilla/5.0', 'cf-connecting-ip': '1.1.1.1' } });
  await onRequest(c1); await flush(c1);
  const c2 = makeContext({ env, headers: { 'user-agent': 'Mozilla/5.0', 'cf-connecting-ip': '2.2.2.2' } });
  await onRequest(c2); await flush(c2);

  assert.equal(env._inserts.length, 2);
});

test('skips known bot user agents', async () => {
  for (const ua of ['Googlebot/2.1', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'curl/7.79.1', 'HeadlessChrome/120']) {
    const ctx = makeContext({ headers: { 'user-agent': ua, 'cf-connecting-ip': '1.2.3.4' } });
    await onRequest(ctx); await flush(ctx);
    assert.equal(ctx._env._inserts.length, 0, `expected no insert for UA: ${ua}`);
  }
});

test('skips prefetch requests', async () => {
  const ctx = makeContext({
    headers: { 'user-agent': 'Mozilla/5.0', 'sec-purpose': 'prefetch', 'cf-connecting-ip': '1.2.3.4' },
  });
  await onRequest(ctx); await flush(ctx);
  assert.equal(ctx._env._inserts.length, 0);
});

test('skips non-GET requests', async () => {
  const ctx = makeContext({ method: 'POST', headers: { 'user-agent': 'Mozilla/5.0' } });
  await onRequest(ctx); await flush(ctx);
  assert.equal(ctx._env._inserts.length, 0);
});

test('skips the landing page', async () => {
  const ctx = makeContext({ url: 'https://tools.example.com/', headers: { 'user-agent': 'Mozilla/5.0' } });
  await onRequest(ctx); await flush(ctx);
  assert.equal(ctx._env._inserts.length, 0);
});

test('skips non-html paths', async () => {
  const ctx = makeContext({ url: 'https://tools.example.com/theme.css', headers: { 'user-agent': 'Mozilla/5.0' } });
  await onRequest(ctx); await flush(ctx);
  assert.equal(ctx._env._inserts.length, 0);
});

test('skips non-200 responses', async () => {
  const ctx = makeContext({ responseStatus: 404, headers: { 'user-agent': 'Mozilla/5.0' } });
  await onRequest(ctx); await flush(ctx);
  assert.equal(ctx._env._inserts.length, 0);
});

test('skips non-html content types', async () => {
  const ctx = makeContext({
    responseHeaders: { 'content-type': 'application/json' },
    headers: { 'user-agent': 'Mozilla/5.0' },
  });
  await onRequest(ctx); await flush(ctx);
  assert.equal(ctx._env._inserts.length, 0);
});

test('does not throw when bindings are missing', async () => {
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

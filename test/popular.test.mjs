// Tests for functions/api/popular.mjs.
//
// Run with: node --test test/popular.test.mjs
//
// The endpoint should:
//   - POST a SQL query to Cloudflare Analytics Engine using the configured
//     account ID and API token, and parse the rows into {tool, hits}
//   - cap to 8 results, last-7-days window, min-hits floor of 5
//   - set a public Cache-Control with max-age >= 60
//   - degrade gracefully when account/token env vars are missing or the
//     HTTP call fails

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/popular.mjs';

const ACCOUNT_ID = 'acct_abc';
const TOKEN = 'tok_xyz';

function installFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return {
    calls,
    restore: () => { globalThis.fetch = original; },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeContext(env) {
  return {
    request: new Request('https://tools.example.com/api/popular'),
    env,
  };
}

test('queries AE SQL API and returns parsed tools', async () => {
  const stub = installFetch(() => jsonResponse({
    data: [
      { tool: 'jq_visualizer', hits: 99.6 },
      { tool: 'regex_tester',  hits: 42.0 },
    ],
  }));
  try {
    const env = { CF_ACCOUNT_ID: ACCOUNT_ID, CF_AE_TOKEN: TOKEN };
    const res = await onRequest(makeContext(env));
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /application\/json/);
    const body = await res.json();
    assert.deepEqual(body, {
      tools: [
        { tool: 'jq_visualizer', hits: 100 },
        { tool: 'regex_tester',  hits: 42 },
      ],
    });
  } finally {
    stub.restore();
  }
});

test('hits the AE SQL endpoint with bearer auth and a SQL body', async () => {
  const stub = installFetch(() => jsonResponse({ data: [] }));
  try {
    const env = { CF_ACCOUNT_ID: ACCOUNT_ID, CF_AE_TOKEN: TOKEN };
    await onRequest(makeContext(env));
    assert.equal(stub.calls.length, 1);
    const { url, init } = stub.calls[0];
    assert.match(url, new RegExp(`/accounts/${ACCOUNT_ID}/analytics_engine/sql$`));
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Authorization'], `Bearer ${TOKEN}`);
    const body = String(init.body);
    assert.match(body, /SELECT/i);
    assert.match(body, /INTERVAL\s+'7'\s+DAY/i);
    assert.match(body, /LIMIT\s+8/i);
    assert.match(body, />=\s*5/);
    assert.match(body, /ORDER BY[^;]*DESC/i);
  } finally {
    stub.restore();
  }
});

test('sets a public Cache-Control header', async () => {
  const stub = installFetch(() => jsonResponse({ data: [] }));
  try {
    const env = { CF_ACCOUNT_ID: ACCOUNT_ID, CF_AE_TOKEN: TOKEN };
    const res = await onRequest(makeContext(env));
    const cc = res.headers.get('cache-control') || '';
    assert.match(cc, /public/);
    const m = cc.match(/max-age=(\d+)/);
    assert.ok(m && parseInt(m[1], 10) >= 60, `expected max-age >= 60, got: ${cc}`);
  } finally {
    stub.restore();
  }
});

test('returns empty list when account ID is missing', async () => {
  const stub = installFetch(() => { throw new Error('should not be called'); });
  try {
    const res = await onRequest(makeContext({ CF_AE_TOKEN: TOKEN }));
    assert.deepEqual(await res.json(), { tools: [] });
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('returns empty list when the API returns non-2xx', async () => {
  const stub = installFetch(() => new Response('nope', { status: 401 }));
  try {
    const env = { CF_ACCOUNT_ID: ACCOUNT_ID, CF_AE_TOKEN: TOKEN };
    const res = await onRequest(makeContext(env));
    assert.deepEqual(await res.json(), { tools: [] });
  } finally {
    stub.restore();
  }
});

test('returns empty list when fetch throws', async () => {
  const stub = installFetch(() => { throw new Error('boom'); });
  try {
    const env = { CF_ACCOUNT_ID: ACCOUNT_ID, CF_AE_TOKEN: TOKEN };
    const res = await onRequest(makeContext(env));
    assert.deepEqual(await res.json(), { tools: [] });
  } finally {
    stub.restore();
  }
});

test('returns empty list when data is missing or null', async () => {
  const stub = installFetch(() => jsonResponse({ data: null }));
  try {
    const env = { CF_ACCOUNT_ID: ACCOUNT_ID, CF_AE_TOKEN: TOKEN };
    const res = await onRequest(makeContext(env));
    assert.deepEqual(await res.json(), { tools: [] });
  } finally {
    stub.restore();
  }
});

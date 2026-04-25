// Tests for functions/api/popular.mjs.
//
// Run with: node --test test/popular.test.mjs
//
// The endpoint should:
//   - return JSON `{ tools: [...] }` from D1 sorted by hits desc
//   - cap to 8 results, last-7-days window, min-hits floor of 5
//   - set a public Cache-Control with max-age >= 60
//   - degrade gracefully when DB binding is missing or the query throws

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/popular.mjs';

function makeEnv({ results = [], throws = false } = {}) {
  const calls = [];
  return {
    DB: {
      prepare(sql) {
        calls.push(sql);
        return {
          bind: () => ({
            all: async () => {
              if (throws) throw new Error('boom');
              return { results };
            },
          }),
          all: async () => {
            if (throws) throw new Error('boom');
            return { results };
          },
        };
      },
    },
    _calls: calls,
  };
}

function makeContext(env) {
  return {
    request: new Request('https://tools.example.com/api/popular'),
    env,
  };
}

test('returns top tools as JSON', async () => {
  const env = makeEnv({
    results: [
      { tool: 'jq_visualizer', hits: 42 },
      { tool: 'regex_tester',  hits: 31 },
    ],
  });
  const res = await onRequest(makeContext(env));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  const body = await res.json();
  assert.deepEqual(body, {
    tools: [
      { tool: 'jq_visualizer', hits: 42 },
      { tool: 'regex_tester',  hits: 31 },
    ],
  });
});

test('SQL uses 7-day window, min-5 floor, and limit 8', async () => {
  const env = makeEnv({ results: [] });
  await onRequest(makeContext(env));
  const sql = env._calls.join(' ');
  assert.match(sql, /tool_hits/i);
  assert.match(sql, /-7 days/);
  assert.match(sql, />=\s*5/);
  assert.match(sql, /LIMIT\s+8/i);
  assert.match(sql, /ORDER BY[^;]*DESC/i);
});

test('sets a public Cache-Control header', async () => {
  const env = makeEnv({ results: [] });
  const res = await onRequest(makeContext(env));
  const cc = res.headers.get('cache-control') || '';
  assert.match(cc, /public/);
  const m = cc.match(/max-age=(\d+)/);
  assert.ok(m && parseInt(m[1], 10) >= 60, `expected max-age >= 60, got: ${cc}`);
});

test('returns empty list when DB binding is missing', async () => {
  const res = await onRequest(makeContext({}));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { tools: [] });
});

test('returns empty list when the query throws', async () => {
  const env = makeEnv({ throws: true });
  const res = await onRequest(makeContext(env));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { tools: [] });
});

test('returns empty list when DB returns null results', async () => {
  const env = {
    DB: {
      prepare: () => ({
        all: async () => ({ results: null }),
        bind: () => ({ all: async () => ({ results: null }) }),
      }),
    },
  };
  const res = await onRequest(makeContext(env));
  assert.deepEqual(await res.json(), { tools: [] });
});

// Tests for functions/api/popular.mjs.
//
// Run with: node --test test/popular.test.mjs
//
// The endpoint should:
//   - list keys under prefix `hits:` from the KV binding
//   - return JSON `{ tools: [{tool, hits}] }` sorted by count desc
//   - cap to 8 results, with a min-hits floor of 5
//   - set a public Cache-Control with max-age >= 60
//   - degrade gracefully when KV is missing or the call throws

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/popular.mjs';

function makeKV(keys, { throws = false } = {}) {
  const calls = [];
  return {
    async list(opts) {
      calls.push(opts);
      if (throws) throw new Error('boom');
      return { keys, list_complete: true, cursor: '' };
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

test('returns top tools as JSON, sorted by count desc', async () => {
  const KV = makeKV([
    { name: 'hits:regex_tester',  metadata: { count: 31 } },
    { name: 'hits:jq_visualizer', metadata: { count: 42 } },
    { name: 'hits:sumo_day',      metadata: { count: 17 } },
  ]);
  const res = await onRequest(makeContext({ KV }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  const body = await res.json();
  assert.deepEqual(body, {
    tools: [
      { tool: 'jq_visualizer', hits: 42 },
      { tool: 'regex_tester',  hits: 31 },
      { tool: 'sumo_day',      hits: 17 },
    ],
  });
});

test('queries KV with the hits: prefix', async () => {
  const KV = makeKV([]);
  await onRequest(makeContext({ KV }));
  assert.equal(KV._calls.length, 1);
  assert.equal(KV._calls[0].prefix, 'hits:');
});

test('filters out tools with fewer than 5 hits', async () => {
  const KV = makeKV([
    { name: 'hits:popular_one', metadata: { count: 10 } },
    { name: 'hits:tiny_one',    metadata: { count: 4 } },
    { name: 'hits:tiny_two',    metadata: { count: 1 } },
  ]);
  const res = await onRequest(makeContext({ KV }));
  const body = await res.json();
  assert.deepEqual(body.tools, [{ tool: 'popular_one', hits: 10 }]);
});

test('caps results at 8', async () => {
  const keys = Array.from({ length: 20 }, (_, i) => ({
    name: `hits:tool_${i}`,
    metadata: { count: 100 - i },
  }));
  const res = await onRequest(makeContext({ KV: makeKV(keys) }));
  const body = await res.json();
  assert.equal(body.tools.length, 8);
  assert.equal(body.tools[0].tool, 'tool_0');
  assert.equal(body.tools[7].tool, 'tool_7');
});

test('treats missing metadata as zero hits', async () => {
  const KV = makeKV([
    { name: 'hits:no_meta',  metadata: null },
    { name: 'hits:has_meta', metadata: { count: 9 } },
  ]);
  const res = await onRequest(makeContext({ KV }));
  const body = await res.json();
  assert.deepEqual(body.tools, [{ tool: 'has_meta', hits: 9 }]);
});

test('sets a public Cache-Control header', async () => {
  const res = await onRequest(makeContext({ KV: makeKV([]) }));
  const cc = res.headers.get('cache-control') || '';
  assert.match(cc, /public/);
  const m = cc.match(/max-age=(\d+)/);
  assert.ok(m && parseInt(m[1], 10) >= 60, `expected max-age >= 60, got: ${cc}`);
});

test('returns empty list when KV binding is missing', async () => {
  const res = await onRequest(makeContext({}));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { tools: [] });
});

test('returns empty list when the KV call throws', async () => {
  const KV = makeKV([], { throws: true });
  const res = await onRequest(makeContext({ KV }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { tools: [] });
});

-- D1 schema for tool popularity tracking.
--
-- Setup (one-time, in the Cloudflare dashboard or via wrangler):
--   1. Create D1 database `tools_stats`.
--   2. Apply this schema:
--        wrangler d1 execute tools_stats --file=schema.sql --remote
--   3. Bind it to the Pages project as `DB` (Settings → Functions → D1 bindings).
--   4. Create a KV namespace `DEDUP` and bind it as `DEDUP`.
--
-- Both bindings are optional at runtime: `_middleware.mjs` and `api/popular.mjs`
-- no-op when the bindings are absent, so previews without bindings still work.

CREATE TABLE IF NOT EXISTS tool_hits (
  tool  TEXT    NOT NULL,
  day   TEXT    NOT NULL,         -- 'YYYY-MM-DD' UTC
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tool, day)
);

CREATE INDEX IF NOT EXISTS idx_tool_hits_day ON tool_hits(day);

// End-to-end Playwright check for the YouTube Transcript Extractor.
//
// Spins up a tiny Node HTTP server that:
//   1. Serves the repo root as static files.
//   2. Implements `/api/youtube_player` by importing the actual Pages
//      Function module (`functions/api/youtube_player.mjs`).
//   3. Implements `/api/proxy` for the caption XML fetch.
//
// Upstream YouTube fetches (oembed, /api/timedtext) are intercepted by
// monkey-patching `globalThis.fetch` on the server so the test is
// deterministic and runs offline.
//
// Run: node test/playwright_youtube.mjs

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = 8197;
const VIDEO_ID = 'dQw4w9WgXcQ';

const OEMBED_BODY = JSON.stringify({
  title: 'Never Gonna Give You Up',
  author_name: 'Rick Astley',
  thumbnail_url: 'https://i.ytimg.com/vi/' + VIDEO_ID + '/hqdefault.jpg',
});

const TIMEDTEXT_LIST = `<?xml version="1.0" encoding="utf-8" ?>
<transcript_list docid="abc">
  <track id="0" name="" lang_code="en" lang_original="English" lang_translated="English" lang_default="true"/>
  <track id="1" name="" lang_code="es" lang_original="español" lang_translated="Spanish"/>
</transcript_list>`;

const TIMEDTEXT_EN = `<?xml version="1.0" encoding="utf-8" ?>
<transcript>
  <text start="0" dur="2.5">We&amp;#39;re no strangers to love</text>
  <text start="2.5" dur="3.0">You know the rules and so do I</text>
  <text start="5.5" dur="3.0">A full commitment&amp;#39;s what I&amp;#39;m thinking of</text>
</transcript>`;

const TIMEDTEXT_ES = `<?xml version="1.0" encoding="utf-8" ?>
<transcript>
  <text start="0" dur="2.5">No somos extraños al amor</text>
  <text start="2.5" dur="3.0">Sabes las reglas y yo también</text>
</transcript>`;

// Install a fetch mock that mimics YouTube's upstream endpoints.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://www.youtube.com/oembed')) {
    return new Response(OEMBED_BODY, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (u.startsWith('https://www.youtube.com/api/timedtext')) {
    const parsed = new URL(u);
    if (parsed.searchParams.get('type') === 'list') {
      return new Response(TIMEDTEXT_LIST, {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      });
    }
    const lang = parsed.searchParams.get('lang');
    const xml = lang === 'es' ? TIMEDTEXT_ES : TIMEDTEXT_EN;
    return new Response(xml, {
      status: 200,
      headers: { 'Content-Type': 'application/xml' },
    });
  }
  return realFetch(url, opts);
};

const { onRequest: youtubePlayerOnRequest } = await import(
  '../functions/api/youtube_player.mjs'
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
};

function buildIncomingRequest(req) {
  const proto = 'http';
  const fullUrl = proto + '://localhost:' + PORT + req.url;
  return new Request(fullUrl, { method: req.method });
}

async function relayResponse(webResp, res) {
  res.statusCode = webResp.status;
  webResp.headers.forEach((v, k) => res.setHeader(k, v));
  const buf = Buffer.from(await webResp.arrayBuffer());
  res.end(buf);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/api/youtube_player') {
      const webResp = await youtubePlayerOnRequest({
        request: buildIncomingRequest(req),
      });
      await relayResponse(webResp, res);
      return;
    }

    if (url.pathname === '/api/proxy') {
      const target = url.searchParams.get('url');
      if (!target) {
        res.statusCode = 400;
        res.end('missing url');
        return;
      }
      // Reuse the real /api/proxy module so behavior matches prod.
      const { onRequest: proxyOnRequest } = await import(
        '../functions/api/proxy.js'
      );
      const webResp = await proxyOnRequest({
        request: new Request('http://localhost/api/proxy?url=' + encodeURIComponent(target)),
      });
      await relayResponse(webResp, res);
      return;
    }

    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = path.join(ROOT, p);
    if (!filePath.startsWith(ROOT)) {
      res.statusCode = 403;
      res.end('forbidden');
      return;
    }
    let body;
    try {
      body = await fs.readFile(filePath);
    } catch {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.end(body);
  } catch (err) {
    res.statusCode = 500;
    res.end(String(err));
  }
});

await new Promise((resolve) => server.listen(PORT, resolve));
console.log('Test server listening on http://localhost:' + PORT);

let exitCode = 0;
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Headless Chromium can't validate certs for external resources
    // (Google Fonts, ytimg thumbnails) in this sandbox. Those load
    // failures are unrelated to the feature under test.
    if (text.includes('ERR_CERT_AUTHORITY_INVALID')) return;
    if (text.includes('Failed to load resource')) return;
    consoleErrors.push('console.error: ' + text);
  });

  await page.goto(
    'http://localhost:' + PORT + '/youtube_transcript.html?v=' + VIDEO_ID,
  );

  // Wait for the video header to appear.
  await page.waitForSelector('#video-section.show', { timeout: 10000 });

  const title = (await page.locator('#video-title').textContent())?.trim();
  const author = (await page.locator('#video-author').textContent())?.trim();
  if (title !== 'Never Gonna Give You Up') {
    throw new Error('Wrong video title: ' + JSON.stringify(title));
  }
  if (author !== 'Rick Astley') {
    throw new Error('Wrong author: ' + JSON.stringify(author));
  }
  console.log('✓ Video header rendered: ' + title + ' / ' + author);

  // Wait for transcript lines to render.
  await page.waitForSelector('#transcript .line', { timeout: 10000 });
  const lines = await page.locator('#transcript .line').count();
  if (lines !== 3) {
    throw new Error('Expected 3 transcript lines, got ' + lines);
  }
  const firstText = (
    await page.locator('#transcript .line').first().locator('.tx').textContent()
  )?.trim();
  if (!firstText || !firstText.includes('strangers to love')) {
    throw new Error('First transcript line did not match: ' + firstText);
  }
  // Make sure XML entity decoding handled &#39; correctly.
  if (!firstText.startsWith("We're")) {
    throw new Error('Entity decoding broken — line was: ' + JSON.stringify(firstText));
  }
  console.log('✓ Transcript rendered with ' + lines + ' lines, first: ' + firstText);

  // Switch language: select the Spanish track and assert lines refresh.
  const langOptions = await page.locator('#lang-select option').count();
  if (langOptions !== 2) throw new Error('Expected 2 language options, got ' + langOptions);
  await page.selectOption('#lang-select', { index: 1 });
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('#transcript .line .tx')).some((el) =>
        el.textContent?.includes('extraños'),
      ),
    null,
    { timeout: 5000 },
  );
  console.log('✓ Language switch reloaded transcript (Spanish)');

  // Verify error path: a video with no captions.
  await page.evaluate(() => {
    document.getElementById('url-input').value = 'NoCapsTest1';
  });
  // Override the timedtext mock to return an empty list for this id.
  // We can't repatch the server's fetch from inside the browser, but we
  // can route the API call directly from the Playwright side instead.
  await page.route('**/api/youtube_player?v=NoCapsTest1', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        playabilityStatus: { status: 'OK' },
        videoDetails: { videoId: 'NoCapsTest1', title: 'No Captions Test', author: 'Tester' },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
      }),
    }),
  );
  await page.locator('#fetch-btn').click();
  await page.waitForSelector('.error-box.show', { timeout: 5000 });
  const errText = (await page.locator('.error-box').textContent())?.trim();
  if (!errText || !errText.toLowerCase().includes('no user-uploaded captions')) {
    throw new Error('Expected no-captions error, got: ' + errText);
  }
  console.log('✓ Empty-captions error rendered correctly');

  if (consoleErrors.length) {
    throw new Error('Console errors: ' + consoleErrors.join('; '));
  }
} catch (err) {
  console.error('✗', err.message);
  exitCode = 1;
} finally {
  await browser.close();
  server.close();
}

process.exit(exitCode);

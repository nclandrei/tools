// Real-model smoke verification for the Image Dimension Estimator.
//
// This test loads the actual YOLOS-tiny model from the Hugging Face CDN
// and runs it on real photographs whose objects' approximate real-world
// dimensions are well known. It is kept separate from the unit tests
// because it requires outbound network access and pulls a ~22 MB model.
//
// Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node test/playwright_image_dimension_estimator_smoke.mjs

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = 8202;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = path.join(ROOT, p);
    if (!filePath.startsWith(ROOT)) { res.statusCode = 403; res.end('forbidden'); return; }
    let body;
    try { body = await fs.readFile(filePath); }
    catch { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
    res.end(body);
  } catch (err) { res.statusCode = 500; res.end(String(err)); }
});

await new Promise((resolve) => server.listen(PORT, resolve));
console.log('Smoke server on http://localhost:' + PORT);

const browser = await chromium.launch({ args: ['--ignore-certificate-errors'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });

// We use two well-known transformers.js sample photographs whose objects
// have widely accepted typical sizes:
//   1. cats.jpg — domestic cats lying together (~45 cm body length)
//   2. football-match.jpg — soccer players (~170 cm tall, on a pitch)
// These are the standard demo images shipped with the transformers.js
// repo; they live at huggingface.co/datasets/Xenova/transformers.js-docs.
const SAMPLES = [
  {
    name: 'cats',
    url: 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/cats.jpg',
    expectedClasses: ['cat'],
    // Typical adult cat body (excl. tail): ~45 cm.
    plausibleRange: { min: 20, max: 90 },
  },
  {
    name: 'football',
    url: 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/football-match.jpg',
    expectedClasses: ['person'],
    plausibleRange: { min: 120, max: 220 },
  },
];

let failed = 0;

try {
  for (const sample of SAMPLES) {
    const page = await ctx.newPage();
    page.on('pageerror', (err) => console.log('  pageerror:', err.message));
    console.log('\n→ ' + sample.name);
    await page.goto('http://localhost:' + PORT + '/image_dimension_estimator.html');

    // Fetch the test photo into a Blob, then push it through the file
    // input so we exercise the same path as a real user upload.
    await page.waitForFunction(() => typeof window.__ide_detect === 'function', { timeout: 60_000 });
    const buf = await page.evaluate(async (url) => {
      const r = await fetch(url);
      const ab = await r.arrayBuffer();
      return Array.from(new Uint8Array(ab));
    }, sample.url);
    await page.locator('#fileInput').setInputFiles({
      name: sample.name + '.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(buf),
    });

    // Wait until detection rows show up (the model is slow first time).
    await page.waitForSelector('#detectionsList .detection-row', { timeout: 180_000 });

    const rows = await page.locator('#detectionsList .detection-row').allTextContents();
    console.log('  rows:', rows);

    const matched = rows.filter((r) =>
      sample.expectedClasses.some((c) => new RegExp(c, 'i').test(r))
    );
    if (matched.length === 0) {
      console.error('  ✗ expected one of', sample.expectedClasses, 'in detections');
      failed++;
      await page.close();
      continue;
    }

    // Ensure the size estimate for the matched class falls in a
    // reasonable range — i.e. the algorithm + auto-fallback didn't
    // produce an obviously wrong number.
    let plausible = false;
    for (const row of matched) {
      const m = row.match(/([0-9]+(?:\.[0-9]+)?)\s*[×x]\s*([0-9]+(?:\.[0-9]+)?)/i);
      if (!m) continue;
      const long = Math.max(parseFloat(m[1]), parseFloat(m[2]));
      if (long >= sample.plausibleRange.min && long <= sample.plausibleRange.max) {
        plausible = true;
        console.log('  ✓ ' + row.trim() + ' (long side ' + long.toFixed(1) + ' cm in [' +
          sample.plausibleRange.min + ',' + sample.plausibleRange.max + '])');
      } else {
        console.log('  ! ' + row.trim() + ' (long side ' + long.toFixed(1) + ' cm out of plausible range)');
      }
    }
    if (!plausible) {
      console.error('  ✗ no detection for', sample.expectedClasses, 'fell in plausible cm range');
      failed++;
    }

    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (failed) {
  console.error('\n' + failed + ' smoke check(s) failed');
  process.exit(1);
}
console.log('\nAll smoke checks passed.');

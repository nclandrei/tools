// End-to-end Playwright tests for the Image Dimension Estimator tool.
//
// The tool uses a Hugging Face object-detection pipeline at runtime,
// but we mock predictions in tests via window.__ide_mock so we can
// verify the dimension-estimation algorithm against known inputs
// (mimicking real photographs whose object sizes we know).
//
// Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node test/playwright_image_dimension_estimator.mjs

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = 8201;

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
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const URL_PAGE = 'http://localhost:' + PORT + '/image_dimension_estimator.html';

// Synthesise a 600x400 PNG that mimics a photo with two recognisable
// objects: a credit-card-like rectangle on the left, and a phone-like
// rectangle on the right. The mock detector below reports bounding
// boxes that match these regions so the algorithm is exercised on
// data with a known ground truth.
//
// Layout (pixels):
//   credit card: (50,150) to (250,276)   → 200×126 px
//   cell phone : (350,80)  to (470,320)  → 120×240 px
//
// A real credit card is 8.56 cm × 5.4 cm. So pixels-per-cm ≈ 200/8.56 ≈ 23.36.
// The phone bbox (120×240 px) at that scale ≈ 5.14 cm × 10.27 cm —
// a believable phone size.
async function makeScenePng(page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 400;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#dddddd';
    ctx.fillRect(0, 0, 600, 400);
    ctx.fillStyle = '#1f6feb';
    ctx.fillRect(50, 150, 200, 126);
    ctx.fillStyle = '#222222';
    ctx.fillRect(350, 80, 120, 240);
    return c.toDataURL('image/png');
  });
  const b64 = dataUrl.split(',', 2)[1];
  return { name: 'scene.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

// Plant the mock BEFORE navigation so it's defined when the page
// loads. This mirrors how recyclable_detector.html exposes
// window.__rd_mock for tests.
async function plantMock(page, predictions) {
  await page.addInitScript((preds) => {
    window.__ide_mock = {
      detect: async () => preds,
    };
  }, predictions);
}

// ── Test 1: page structure ───────────────────────────────────────────────
test('page renders with title, drop zone, and back link', async (page) => {
  await page.goto(URL_PAGE);
  const title = await page.title();
  if (!/dimension/i.test(title)) throw new Error('Title missing "dimension": ' + title);
  const h1 = (await page.locator('h1').first().textContent())?.trim();
  if (!h1 || !/dimension/i.test(h1)) throw new Error('h1 missing: ' + h1);
  const back = await page.locator('a[href="/"]').count();
  if (back === 0) throw new Error('Missing back link to /');
  if ((await page.locator('#dropZone').count()) === 0) throw new Error('Missing #dropZone');
  if ((await page.locator('#fileInput').count()) === 0) throw new Error('Missing #fileInput');
  if ((await page.locator('#referenceSelect').count()) === 0) throw new Error('Missing #referenceSelect');
});

// ── Test 2: light/dark theme inheritance ─────────────────────────────────
test('theme.css loaded and theme attribute set on <html>', async (page) => {
  await page.goto(URL_PAGE);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  if (theme !== 'light' && theme !== 'dark') throw new Error('Theme attr missing: ' + theme);
  const cssLinks = await page.locator('link[href*="theme.css"]').count();
  if (cssLinks === 0) throw new Error('theme.css link not present');
});

// ── Test 3: pure algorithm sanity — pixels→cm via a reference ───────────
// estimateDimensions(detections, referenceCmPerPixel) returns each
// detection's width and height in cm. Algorithmic test.
test('estimateDimensions scales pixel boxes to cm using a reference', async (page) => {
  await page.goto(URL_PAGE);
  const out = await page.evaluate(() => {
    const detections = [
      { label: 'credit card', score: 0.9, box: { xmin: 50, ymin: 150, xmax: 250, ymax: 276 } },
      { label: 'cell phone',  score: 0.95, box: { xmin: 350, ymin: 80, xmax: 470, ymax: 320 } },
    ];
    // Reference: 200 px ↔ 8.56 cm (a credit card's long side)
    const cmPerPx = 8.56 / 200;
    return window.__ide.estimateDimensions(detections, cmPerPx);
  });
  if (out.length !== 2) throw new Error('Expected 2 estimates, got ' + out.length);
  // Credit card: 200×126 px → ~8.56 × 5.39 cm
  const cc = out[0];
  if (Math.abs(cc.widthCm - 8.56) > 0.05) throw new Error('CC width wrong: ' + cc.widthCm);
  if (Math.abs(cc.heightCm - 5.39) > 0.1) throw new Error('CC height wrong: ' + cc.heightCm);
  // Phone: 120×240 px → ~5.14 × 10.27 cm
  const phone = out[1];
  if (Math.abs(phone.widthCm - 5.14) > 0.1) throw new Error('Phone width wrong: ' + phone.widthCm);
  if (Math.abs(phone.heightCm - 10.27) > 0.1) throw new Error('Phone height wrong: ' + phone.heightCm);
});

// ── Test 4: scale-from-reference picks the right detection ──────────────
test('scaleFromReference uses the matching detection for a known reference', async (page) => {
  await page.goto(URL_PAGE);
  const cmPerPx = await page.evaluate(() => {
    const detections = [
      { label: 'cell phone',  score: 0.95, box: { xmin: 350, ymin: 80, xmax: 470, ymax: 320 } },
      { label: 'credit card', score: 0.9, box: { xmin: 50, ymin: 150, xmax: 250, ymax: 276 } },
    ];
    // ask for credit-card scale → its long side (200 px) maps to 8.56 cm
    return window.__ide.scaleFromReference(detections, 'credit-card');
  });
  if (cmPerPx === null) throw new Error('Expected a scale, got null');
  const expected = 8.56 / 200;
  if (Math.abs(cmPerPx - expected) > 1e-4)
    throw new Error('Expected ' + expected + ' cm/px, got ' + cmPerPx);
});

// ── Test 5: reference fallback by typical class size ────────────────────
test('scaleFromTypical falls back when no explicit reference is chosen', async (page) => {
  await page.goto(URL_PAGE);
  const cmPerPx = await page.evaluate(() => {
    const detections = [
      // Person standing 320 px tall ≈ 170 cm typical height
      { label: 'person', score: 0.99, box: { xmin: 100, ymin: 40, xmax: 220, ymax: 360 } },
      { label: 'cell phone', score: 0.6, box: { xmin: 400, ymin: 200, xmax: 460, ymax: 300 } },
    ];
    return window.__ide.scaleFromTypical(detections);
  });
  if (cmPerPx === null) throw new Error('Expected a typical-size scale, got null');
  const expected = 170 / 320;
  if (Math.abs(cmPerPx - expected) > 1e-3)
    throw new Error('Expected ~' + expected + ' cm/px, got ' + cmPerPx);
});

// ── Test 6: end-to-end — upload a synthesised scene with mock detector ──
test('uploading an image renders bounding boxes with cm dimensions', async (page) => {
  await plantMock(page, [
    { label: 'credit card', score: 0.92, box: { xmin: 50, ymin: 150, xmax: 250, ymax: 276 } },
    { label: 'cell phone',  score: 0.88, box: { xmin: 350, ymin: 80, xmax: 470, ymax: 320 } },
  ]);
  await page.goto(URL_PAGE);
  await page.locator('#referenceSelect').selectOption('credit-card');

  const file = await makeScenePng(page);
  await page.locator('#fileInput').setInputFiles(file);

  // Wait for the result panel to populate.
  await page.waitForSelector('#detectionsList .detection-row', { timeout: 5000 });

  const rows = await page.locator('#detectionsList .detection-row').count();
  if (rows !== 2) throw new Error('Expected 2 detection rows, got ' + rows);

  // Phone row should display the estimated cm dimensions.
  const phoneText = await page.locator('#detectionsList .detection-row', { hasText: 'cell phone' }).textContent();
  // Tolerance check using a regex with the rounded numbers (allow 1 mm rounding).
  if (!phoneText) throw new Error('No phone row text');
  const m = phoneText.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:cm|×)?\s*[×x]\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) throw new Error('Phone row missing W×H: ' + phoneText);
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  if (Math.abs(w - 5.14) > 0.2) throw new Error('Phone W not ≈5.14 cm: ' + w);
  if (Math.abs(h - 10.27) > 0.3) throw new Error('Phone H not ≈10.27 cm: ' + h);

  // An overlay canvas should have been drawn matching the source image.
  const overlay = await page.evaluate(() => {
    const c = document.getElementById('overlayCanvas');
    return c ? { w: c.width, h: c.height } : null;
  });
  if (!overlay) throw new Error('Missing #overlayCanvas');
  if (overlay.w !== 600 || overlay.h !== 400)
    throw new Error('Overlay canvas size wrong: ' + JSON.stringify(overlay));
});

// ── Test 7: changing reference recomputes dimensions ────────────────────
// Detections deliberately chosen so that "reference=credit-card" and
// "reference=auto" derive DIFFERENT scales:
//  - Auto picks the highest-confidence detection with a known typical
//    size. With score(book) > score(credit card), the typical-class
//    branch picks the book (24 cm tall, 240 px tall → 0.1 cm/px).
//  - Reference=credit-card picks the CC bbox (200 px ↔ 8.56 cm →
//    0.0428 cm/px).
test('changing the reference type recomputes dimensions', async (page) => {
  await plantMock(page, [
    { label: 'credit card', score: 0.7,  box: { xmin: 50,  ymin: 150, xmax: 250, ymax: 276 } },
    { label: 'book',        score: 0.95, box: { xmin: 350, ymin: 80,  xmax: 520, ymax: 320 } },
  ]);
  await page.goto(URL_PAGE);

  await page.locator('#referenceSelect').selectOption('credit-card');
  await page.locator('#fileInput').setInputFiles(await makeScenePng(page));
  await page.waitForSelector('#detectionsList .detection-row', { timeout: 5000 });

  const bookTextCC = await page.locator('#detectionsList .detection-row', { hasText: 'book' }).textContent();
  const mCC = bookTextCC.match(/([0-9]+(?:\.[0-9]+)?)\s*[×x]\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!mCC) throw new Error('No dim w/CC ref: ' + bookTextCC);
  // Book bbox 170×240 px at 0.0428 cm/px ≈ 7.3×10.3 cm
  if (Math.abs(parseFloat(mCC[2]) - 10.27) > 0.3)
    throw new Error('Book height w/CC ref expected ≈10.3 cm, got ' + mCC[2]);

  // Switch to auto → falls back to typical-class size on the book (24 cm).
  await page.locator('#referenceSelect').selectOption('auto');
  await page.waitForFunction(
    (prev) => {
      const row = Array.from(document.querySelectorAll('#detectionsList .detection-row'))
        .find(r => /book/i.test(r.textContent));
      return row && row.textContent !== prev;
    },
    bookTextCC,
    { timeout: 5000 },
  );
  const bookTextAuto = await page.locator('#detectionsList .detection-row', { hasText: 'book' }).textContent();
  if (bookTextAuto === bookTextCC) throw new Error('Book dimension did not change after reference switch');
  const mAuto = bookTextAuto.match(/([0-9]+(?:\.[0-9]+)?)\s*[×x]\s*([0-9]+(?:\.[0-9]+)?)/i);
  // After fallback the book reports its typical size (≈17×24 cm).
  if (Math.abs(parseFloat(mAuto[2]) - 24) > 1)
    throw new Error('Book height w/auto expected ≈24 cm, got ' + mAuto[2]);
});

try {
  const ctx = await browser.newContext();
  for (const { name, fn } of tests) {
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (text.includes('ERR_CERT_AUTHORITY_INVALID')) return;
      if (text.includes('Failed to load resource')) return;
      consoleErrors.push('console.error: ' + text);
    });
    try {
      await fn(page);
      if (consoleErrors.length)
        throw new Error('Console errors: ' + consoleErrors.join('; '));
      console.log('✓ ' + name);
    } catch (err) {
      console.error('✗ ' + name + ' — ' + err.message);
      exitCode = 1;
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

process.exit(exitCode);

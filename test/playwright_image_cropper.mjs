// End-to-end Playwright check for the Image Cropper / Rotator tool.
//
// Spins up a tiny static file server rooted at the repo, then drives
// the page through chromium. The tool is purely client-side, so no
// API mocks are required.
//
// Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node test/playwright_image_cropper.mjs

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = 8198;

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

// Synthesise a 100x60 PNG with four solid quadrants so we can
// detect rotation and crop visually:
//   ┌────────┬────────┐
//   │  RED   │ GREEN  │
//   ├────────┼────────┤
//   │  BLUE  │ YELLOW │
//   └────────┴────────┘
// Returned as a {name, mimeType, buffer} compatible with
// page.locator('input[type=file]').setInputFiles(...).
async function makeTestPng(page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 100;
    c.height = 60;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 50, 30);
    ctx.fillStyle = '#00ff00'; ctx.fillRect(50, 0, 50, 30);
    ctx.fillStyle = '#0000ff'; ctx.fillRect(0, 30, 50, 30);
    ctx.fillStyle = '#ffff00'; ctx.fillRect(50, 30, 50, 30);
    return c.toDataURL('image/png');
  });
  const b64 = dataUrl.split(',', 2)[1];
  return {
    name: 'test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(b64, 'base64'),
  };
}

// ── Test 1: page structure ───────────────────────────────────────────────
test('page renders with title, drop zone, and back link', async (page) => {
  await page.goto('http://localhost:' + PORT + '/image_cropper.html');
  const title = await page.title();
  if (!/crop/i.test(title)) throw new Error('Title missing "crop": ' + title);
  const h1 = (await page.locator('h1').first().textContent())?.trim();
  if (!h1 || !/crop/i.test(h1)) throw new Error('h1 missing: ' + h1);
  const back = await page.locator('a[href="/"]').count();
  if (back === 0) throw new Error('Missing back link to /');
  if ((await page.locator('#dropZone').count()) === 0)
    throw new Error('Missing #dropZone');
  if ((await page.locator('#fileInput').count()) === 0)
    throw new Error('Missing #fileInput');
});

// ── Test 2: upload + canvas display ──────────────────────────────────────
test('uploading an image renders it on the working canvas', async (page) => {
  await page.goto('http://localhost:' + PORT + '/image_cropper.html');
  const file = await makeTestPng(page);
  await page.locator('#fileInput').setInputFiles(file);
  await page.waitForSelector('#canvas:not([hidden])', { timeout: 5000 });

  // The canvas backing store must reflect the source image dimensions
  // so future crop/rotate operations don't lose pixels to scaling.
  const dims = await page.evaluate(() => {
    const c = document.getElementById('canvas');
    return { w: c.width, h: c.height };
  });
  if (dims.w !== 100 || dims.h !== 60) {
    throw new Error('Canvas dims wrong: ' + JSON.stringify(dims));
  }

  // Confirm the image actually drew by sampling four quadrants.
  const quads = await page.evaluate(() => {
    const c = document.getElementById('canvas');
    const ctx = c.getContext('2d');
    const px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3);
    return {
      tl: px(10, 10),
      tr: px(75, 10),
      bl: px(10, 45),
      br: px(75, 45),
    };
  });
  const eq = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 5);
  if (!eq(quads.tl, [255, 0, 0])) throw new Error('TL not red: ' + quads.tl);
  if (!eq(quads.tr, [0, 255, 0])) throw new Error('TR not green: ' + quads.tr);
  if (!eq(quads.bl, [0, 0, 255])) throw new Error('BL not blue: ' + quads.bl);
  if (!eq(quads.br, [255, 255, 0])) throw new Error('BR not yellow: ' + quads.br);
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

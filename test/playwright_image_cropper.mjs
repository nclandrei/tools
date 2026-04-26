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

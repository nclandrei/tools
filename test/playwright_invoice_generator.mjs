// End-to-end Playwright check for the Invoice Generator tool.
//
// Spins up a static file server rooted at the repo, then drives
// the page through chromium with the system clock pinned to a
// fixed date so the default-date logic is deterministic.
//
// Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node test/playwright_invoice_generator.mjs

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = 8199;

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

const URL_BASE = 'http://localhost:' + PORT + '/invoice_generator.html';

// Pin Date so default-date assertions are deterministic regardless of when
// the test runs.
async function pinDate(page, isoDate) {
  await page.addInitScript(`(() => {
    const FROZEN = ${JSON.stringify(isoDate)};
    const Real = Date;
    const fixed = new Real(FROZEN).getTime();
    const offset = fixed - Real.now();
    function FakeDate(...args) {
      if (args.length === 0) return new Real(Real.now() + offset);
      return new Real(...args);
    }
    FakeDate.prototype = Real.prototype;
    FakeDate.now = () => Real.now() + offset;
    FakeDate.parse = Real.parse;
    FakeDate.UTC = Real.UTC;
    Object.setPrototypeOf(FakeDate, Real);
    globalThis.Date = FakeDate;
  })()`);
}

// ── Test: bank fields exist and render in invoice ─────────────────────
test('bank fields (name, address, iban, bic) appear in form and rendered invoice', async (page) => {
  await pinDate(page, '2026-04-30T12:00:00Z');
  await page.goto(URL_BASE);
  for (const id of ['bank-name', 'bank-address', 'iban', 'bic']) {
    if ((await page.locator('#' + id).count()) === 0)
      throw new Error('Missing #' + id);
  }
  await page.locator('#from-name').fill('Nicolae Andrei-Mihai PFA');
  await page.locator('#from-details').fill('Str. Mihai Viteazul 13, Romania');
  await page.locator('#to-name').fill('Bridgit Inc.');
  await page.locator('#to-details').fill('55 Northfield Drive East, Unit 150\nWaterloo, ON Canada\nN2K 3T6');
  await page.locator('#bank-name').fill('Revolut Bank');
  await page.locator('#bank-address').fill('1 Canada Square, London, UK');
  await page.locator('#iban').fill('RO27REVO0000118679654321');
  await page.locator('#bic').fill('REVOLT21XXX');
  await page.locator('#amount').fill('5500');
  await page.locator('#hours').fill('50');
  await page.locator('button:has-text("Generate Invoice")').click();
  const html = await page.locator('#invoice-preview').innerHTML();
  for (const expected of ['Revolut Bank', '1 Canada Square, London, UK', 'RO27REVO0000118679654321', 'REVOLT21XXX']) {
    if (!html.includes(expected))
      throw new Error('Invoice missing bank info: ' + expected);
  }
  if (!/Northfield/.test(html) || !/Waterloo/.test(html) || !/N2K 3T6/.test(html))
    throw new Error('Invoice missing client multi-line address');
});

// ── Test: bank fields persist via profile save/load ───────────────────
test('bank fields are saved and restored via profile', async (page) => {
  await pinDate(page, '2026-04-30T12:00:00Z');
  await page.goto(URL_BASE);
  await page.locator('#to-name').fill('TestCo');
  await page.locator('#bank-name').fill('My Bank');
  await page.locator('#bank-address').fill('Bank St 1');
  await page.locator('#iban').fill('GB00TEST00001234');
  await page.locator('#bic').fill('TESTGB22');
  await page.locator('#rate').fill('100');
  await page.locator('button:has-text("Save as Profile")').click();
  await page.reload();
  await page.locator('#profile-select').selectOption('TestCo');
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  if ((await page.locator('#bank-name').inputValue()) !== 'My Bank') throw new Error('bank-name not restored');
  if ((await page.locator('#bank-address').inputValue()) !== 'Bank St 1') throw new Error('bank-address not restored');
  if ((await page.locator('#iban').inputValue()) !== 'GB00TEST00001234') throw new Error('iban not restored');
  if ((await page.locator('#bic').inputValue()) !== 'TESTGB22') throw new Error('bic not restored');
  if ((await page.locator('#rate').inputValue()) !== '100') throw new Error('rate not restored');
});

// ── Test: rate per hour with auto-compute ─────────────────────────────
test('rate-per-hour times hours auto-fills the amount field', async (page) => {
  await pinDate(page, '2026-04-30T12:00:00Z');
  await page.goto(URL_BASE);
  if ((await page.locator('#rate').count()) === 0) throw new Error('Missing #rate input');
  await page.locator('#rate').fill('110');
  await page.locator('#hours').fill('50');
  await page.locator('#hours').blur();
  const amount = await page.locator('#amount').inputValue();
  if (parseFloat(amount) !== 5500)
    throw new Error('amount expected 5500, got ' + amount);
});

// ── Test: client details is a multi-line textarea ─────────────────────
test('client details field is a textarea preserving line breaks', async (page) => {
  await pinDate(page, '2026-04-30T12:00:00Z');
  await page.goto(URL_BASE);
  const tag = await page.locator('#to-details').evaluate((el) => el.tagName);
  if (tag !== 'TEXTAREA') throw new Error('#to-details expected TEXTAREA, got ' + tag);
  const multiline = 'Bridgit Inc.\n55 Northfield Drive East, Unit 150\nWaterloo, ON Canada\nN2K 3T6';
  await page.locator('#to-details').fill(multiline);
  const got = await page.locator('#to-details').inputValue();
  if (got !== multiline) throw new Error('multiline value not preserved: ' + JSON.stringify(got));
});

// ── Test: default dates use the current month ─────────────────────────
test('default dates: current-month period, today issue, last-day-of-next-month due', async (page) => {
  await pinDate(page, '2026-04-30T12:00:00Z');
  await page.goto(URL_BASE);
  const ps = await page.locator('#period-start').inputValue();
  const pe = await page.locator('#period-end').inputValue();
  const iss = await page.locator('#issue-date').inputValue();
  const due = await page.locator('#due-date').inputValue();
  if (ps !== '2026-04-01') throw new Error('period-start expected 2026-04-01, got ' + ps);
  if (pe !== '2026-04-30') throw new Error('period-end expected 2026-04-30, got ' + pe);
  if (iss !== '2026-04-30') throw new Error('issue-date expected 2026-04-30, got ' + iss);
  if (due !== '2026-05-31') throw new Error('due-date expected 2026-05-31, got ' + due);
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

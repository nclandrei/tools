const { test, expect } = require('@playwright/test');

test.describe('Unicode Reference', () => {

  test('page loads with correct title and header', async ({ page }) => {
    await page.goto('/unicode_reference.html');
    await expect(page).toHaveTitle('Unicode Reference');
    await expect(page.locator('header h1')).toHaveText('Unicode Reference');
    expect(await page.getAttribute('header a', 'href')).toBe('/');
    await expect(page.locator('.desc')).toContainText('Searchable ASCII');
  });

  test('table renders paginated rows', async ({ page }) => {
    await page.goto('/unicode_reference.html');
    const rows = page.locator('#tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(50);
    expect(count).toBeLessThanOrEqual(200);
    await expect(page.locator('#stats')).toContainText('Showing');
  });

  test('block filter has many options', async ({ page }) => {
    await page.goto('/unicode_reference.html');
    const options = await page.locator('#block-filter option').count();
    expect(options).toBeGreaterThan(10);
  });

  test('search by character name', async ({ page }) => {
    await page.goto('/unicode_reference.html');
    await page.fill('#search', 'ampersand');
    await page.waitForTimeout(300);
    const rows = await page.locator('#tbody tr').count();
    expect(rows).toBeGreaterThanOrEqual(1);
    expect(rows).toBeLessThan(10);
    await expect(page.locator('#tbody tr').first()).toContainText('AMPERSAND');
  });

  test('search by code point U+0041 finds letter A', async ({ page }) => {
    await page.goto('/unicode_reference.html');
    await page.fill('#search', 'U+0041');
    await page.waitForTimeout(300);
    const text = await page.locator('#tbody tr').first().textContent();
    expect(text).toContain('LATIN CAPITAL LETTER A');
  });

  test('search by decimal', async ({ page }) => {
    await page.goto('/unicode_reference.html');
    await page.fill('#search', '65');
    await page.waitForTimeout(300);
    expect(await page.locator('#tbody tr').count()).toBeGreaterThanOrEqual(1);
  });

  test('search by hex 0x2190 finds arrow', async ({ page }) => {
    await page.goto('/unicode_reference.html');
    await page.fill('#search', '0x2190');
    await page.waitForTimeout(300);
    expect(await page.locator('#tbody tr').count()).toBeGreaterThanOrEqual(1);
    await expect(page.locator('#tbody .code-point').first()).toContainText('2190');
  });

  test('filter by Arrows block', async ({ page }) => {
    await page.goto('/unicode_reference.html');
    await page.selectOption('#block-filter', 'Arrows');
    await page.waitForTimeout(300);
    const rows = await page.locator('#tbody tr').count();
    expect(rows).toBeGreaterThan(30);
    const labels = await page.locator('#tbody .block-label').allTextContents();
    expect(labels.every(l => l === 'Arrows')).toBe(true);
  });

  test('filter by Box Drawing block', async ({ page }) => {
    await page.goto('/unicode_reference.html');
    await page.selectOption('#block-filter', 'Box Drawing');
    await page.waitForTimeout(300);
    expect(await page.locator('#tbody tr').count()).toBeGreaterThan(30);
  });

  test('empty state for bad search', async ({ page }) => {
    await page.goto('/unicode_reference.html');
    await page.fill('#search', 'zzzznonexistent12345');
    await page.waitForTimeout(300);
    await expect(page.locator('#empty')).toBeVisible();
  });

  test('load more button adds rows', async ({ page }) => {
    await page.goto('/unicode_reference.html');
    const before = await page.locator('#tbody tr').count();
    await expect(page.locator('#load-more')).toBeVisible();
    await page.click('#load-more-btn');
    await page.waitForTimeout(200);
    const after = await page.locator('#tbody tr').count();
    expect(after).toBeGreaterThan(before);
  });

  test('click to copy adds copied class', async ({ browser }) => {
    const context = await browser.newContext();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage();
    await page.goto('/unicode_reference.html');
    await page.fill('#search', 'dollar');
    await page.waitForTimeout(300);
    const cell = page.locator('#tbody .char-cell').first();
    await cell.click();
    await page.waitForTimeout(200);
    await expect(cell).toHaveClass(/copied/);
    await context.close();
  });

  test('dark and light themes apply', async ({ page }) => {
    await page.goto('/unicode_reference.html');
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    const bgDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bgDark).not.toBe('rgb(250, 250, 248)');

    await page.evaluate(() => document.documentElement.dataset.theme = 'light');
    const bgLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bgLight).not.toBe(bgDark);
  });

  test('mobile-hidden columns exist', async ({ page }) => {
    await page.goto('/unicode_reference.html');
    expect(await page.locator('th.hide-mobile').count()).toBeGreaterThanOrEqual(2);
  });

  test('/ key focuses search', async ({ page }) => {
    await page.goto('/unicode_reference.html');
    await page.locator('body').click();
    await page.keyboard.press('/');
    const focused = await page.evaluate(() => document.activeElement.id);
    expect(focused).toBe('search');
  });

  test('HTML entity column shows correct value', async ({ page }) => {
    await page.goto('/unicode_reference.html');
    await page.fill('#search', 'ampersand');
    await page.waitForTimeout(300);
    const html = await page.locator('#tbody .html-col').first().textContent();
    expect(html).toBe('&amp;');
  });

  test('Mathematical Operators block', async ({ page }) => {
    await page.goto('/unicode_reference.html');
    await page.selectOption('#block-filter', 'Mathematical Operators');
    await page.waitForTimeout(300);
    expect(await page.locator('#tbody tr').count()).toBeGreaterThan(50);
  });

  test('mobile viewport hides columns', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/unicode_reference.html');
    const hiddenTh = page.locator('th.hide-mobile').first();
    await expect(hiddenTh).toBeHidden();
  });

  test('tool card exists on index page', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('a.tool-card[href="/unicode_reference.html"]');
    await expect(card).toBeVisible();
    await expect(card.locator('.tool-title')).toHaveText('Unicode Reference');
  });
});

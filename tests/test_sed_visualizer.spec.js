const { test, expect } = require('@playwright/test');

const BASE = 'http://127.0.0.1:8091';

test.describe('Sed Visualizer', () => {

  test('page loads with title and default content', async ({ page }) => {
    await page.goto(BASE + '/sed_visualizer.html');
    await expect(page).toHaveTitle('Sed Visualizer');
    await expect(page.locator('h1')).toHaveText('Sed Visualizer');
    await expect(page.locator('a[href="/"]')).toBeVisible();
    // Input textarea should have default text
    const inputVal = await page.locator('#input-text').inputValue();
    expect(inputVal).toContain('Hello World');
  });

  test('basic substitution s/foo/bar/g works', async ({ page }) => {
    await page.goto(BASE + '/sed_visualizer.html');
    await page.fill('#sed-input', 's/Hello/Goodbye/');
    // Output should show the substitution
    const output = await page.locator('#output-box').textContent();
    expect(output).toContain('Goodbye World');
    expect(output).not.toContain('Hello World');
  });

  test('global substitution flag works', async ({ page }) => {
    await page.goto(BASE + '/sed_visualizer.html');
    await page.fill('#input-text', 'aaa bbb aaa');
    await page.fill('#sed-input', 's/aaa/ccc/g');
    const output = await page.locator('#output-box').textContent();
    expect(output).toBe('ccc bbb ccc');
  });

  test('delete command /pattern/d works', async ({ page }) => {
    await page.goto(BASE + '/sed_visualizer.html');
    await page.fill('#input-text', 'keep\ndelete me\nkeep too');
    await page.fill('#sed-input', '/delete/d');
    const output = await page.locator('#output-box').textContent();
    expect(output).toContain('keep');
    expect(output).toContain('keep too');
    expect(output).not.toContain('delete me');
  });

  test('line range delete 2,4d works', async ({ page }) => {
    await page.goto(BASE + '/sed_visualizer.html');
    await page.fill('#input-text', 'line 1\nline 2\nline 3\nline 4\nline 5');
    await page.fill('#sed-input', '2,4d');
    const output = await page.locator('#output-box').textContent();
    expect(output).toBe('line 1\nline 5');
  });

  test('transliterate y/abc/ABC/ works', async ({ page }) => {
    await page.goto(BASE + '/sed_visualizer.html');
    await page.fill('#input-text', 'a big cat');
    await page.fill('#sed-input', 'y/abc/ABC/');
    const output = await page.locator('#output-box').textContent();
    expect(output).toBe('A Big CAt');
  });

  test('chained commands with semicolon', async ({ page }) => {
    await page.goto(BASE + '/sed_visualizer.html');
    await page.fill('#input-text', 'hello world');
    await page.fill('#sed-input', 's/hello/hi/;s/world/earth/');
    const output = await page.locator('#output-box').textContent();
    expect(output).toBe('hi earth');
    // Pipeline section should be visible for multi-command
    await expect(page.locator('#pipeline-section')).toBeVisible();
  });

  test('diff section shows changes', async ({ page }) => {
    await page.goto(BASE + '/sed_visualizer.html');
    await page.fill('#input-text', 'foo bar');
    await page.fill('#sed-input', 's/foo/baz/');
    // Diff should have added and removed lines
    const diffHtml = await page.locator('#diff-box').innerHTML();
    expect(diffHtml).toContain('diff-line');
  });

  test('preset buttons load command and text', async ({ page }) => {
    await page.goto(BASE + '/sed_visualizer.html');
    // Click the first preset
    await page.locator('.preset-btn').first().click();
    const cmdVal = await page.locator('#sed-input').inputValue();
    expect(cmdVal).toBe('s/foo/bar/g');
    const output = await page.locator('#output-box').textContent();
    expect(output).toContain('bar');
    expect(output).not.toContain('foo');
  });

  test('error message shown for invalid command', async ({ page }) => {
    await page.goto(BASE + '/sed_visualizer.html');
    await page.fill('#sed-input', 'z/invalid/');
    await expect(page.locator('#error-msg')).toBeVisible();
  });

  test('copy button exists and is clickable', async ({ page }) => {
    await page.goto(BASE + '/sed_visualizer.html');
    await page.fill('#sed-input', 's/Hello/Hi/');
    const copyBtn = page.locator('#copy-btn');
    await expect(copyBtn).toBeVisible();
    await expect(copyBtn).toBeEnabled();
  });

  test('line addressing works (2s/...)', async ({ page }) => {
    await page.goto(BASE + '/sed_visualizer.html');
    await page.fill('#input-text', 'aaa\nbbb\nccc');
    await page.fill('#sed-input', '2s/bbb/XXX/');
    const output = await page.locator('#output-box').textContent();
    expect(output).toBe('aaa\nXXX\nccc');
  });

  test('regex addressing works (/pat/s/...)', async ({ page }) => {
    await page.goto(BASE + '/sed_visualizer.html');
    await page.fill('#input-text', 'apple pie\nbanana split\napple sauce');
    await page.fill('#sed-input', '/apple/s/apple/FRUIT/');
    const output = await page.locator('#output-box').textContent();
    expect(output).toContain('FRUIT pie');
    expect(output).toContain('banana split');
    expect(output).toContain('FRUIT sauce');
  });

  test('dark theme support', async ({ page }) => {
    await page.goto(BASE + '/sed_visualizer.html');
    // Set dark theme
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    const bg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor
    );
    // Dark theme bg should be dark
    expect(bg).not.toBe('rgb(250, 250, 248)');
  });

  test('light theme support', async ({ page }) => {
    await page.goto(BASE + '/sed_visualizer.html');
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
    });
    const bg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor
    );
    expect(bg).toBe('rgb(250, 250, 248)');
  });

  test('back link to All tools works', async ({ page }) => {
    await page.goto(BASE + '/sed_visualizer.html');
    const backLink = page.locator('header a[href="/"]');
    await expect(backLink).toHaveText('← All tools');
  });

  test('tool card exists on index page', async ({ page }) => {
    await page.goto(BASE + '/index.html');
    const card = page.locator('a[href="/sed_visualizer.html"]');
    await expect(card).toBeVisible();
    await expect(card.locator('.tool-title')).toHaveText('Sed Visualizer');
  });

  test('case insensitive flag works', async ({ page }) => {
    await page.goto(BASE + '/sed_visualizer.html');
    await page.fill('#input-text', 'Hello HELLO hello');
    await page.fill('#sed-input', 's/hello/hi/gi');
    const output = await page.locator('#output-box').textContent();
    expect(output).toBe('hi hi hi');
  });

  test('empty sed expression shows original text', async ({ page }) => {
    await page.goto(BASE + '/sed_visualizer.html');
    await page.fill('#sed-input', '');
    const output = await page.locator('#output-box').textContent();
    const input = await page.locator('#input-text').inputValue();
    expect(output).toBe(input);
  });
});

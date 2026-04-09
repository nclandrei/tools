const { test, expect } = require('@playwright/test');

test.describe('Background Remover', () => {
  test('page loads and shows drop zone', async ({ page }) => {
    await page.goto('/background_remover.html');
    await expect(page.locator('h1')).toHaveText('Background Remover');
    await expect(page.locator('#dropZone')).toBeVisible();
  });

  test('download button uses blob URL, not data URL, to avoid Safari navigation bug', async ({ page }) => {
    const response = await page.goto('/background_remover.html');
    const html = await response.text();

    // The bug: using a data: URL in an <a> tag causes Safari iOS to navigate
    // to the data URL instead of downloading. The download handler must use
    // blob URLs (URL.createObjectURL) instead of data URLs.

    // The download click handler must NOT set a.href to resultImg.src (which is a data URL)
    // It should use canvas.toBlob + URL.createObjectURL or equivalent blob approach
    expect(html).not.toMatch(/a\.href\s*=\s*resultImg\.src/);
    expect(html).toContain('toBlob');
    expect(html).toContain('createObjectURL');
  });

  test('result image uses blob URL instead of data URL', async ({ page }) => {
    const response = await page.goto('/background_remover.html');
    const html = await response.text();

    // resultImg.src should not be set to a toDataURL() result directly
    // It should use a blob URL via canvas.toBlob + URL.createObjectURL
    expect(html).not.toMatch(/resultImg\.src\s*=\s*workCanvas\.toDataURL/);
  });

  test('download triggers blob download without page navigation', async ({ page }) => {
    await page.goto('/background_remover.html');

    // Simulate a processed image: draw on the canvas and set up state
    await page.evaluate(() => {
      const canvas = document.getElementById('workCanvas');
      canvas.width = 10;
      canvas.height = 10;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, 10, 10);
    });

    // Mock the result image with a blob URL to simulate post-processing state
    const resultSrc = await page.evaluate(async () => {
      const canvas = document.getElementById('workCanvas');
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const url = URL.createObjectURL(blob);
      document.getElementById('resultImg').src = url;
      return url;
    });

    // The result image src should be a blob URL, not a data URL
    expect(resultSrc).toMatch(/^blob:/);

    // Click download and verify we don't navigate away
    let navigated = false;
    page.on('framenavigated', () => { navigated = true; });

    // Make download button visible and click it
    await page.evaluate(() => {
      document.getElementById('resultArea').classList.add('visible');
    });
    await page.click('#downloadBtn');

    // Small wait to allow any navigation to occur
    await page.waitForTimeout(500);

    // We should still be on the same page, not navigated to a data: URL
    const currentUrl = page.url();
    expect(currentUrl).not.toMatch(/^data:/);
    expect(currentUrl).toContain('background_remover.html');
  });
});

const { test, expect } = require('@playwright/test');
const path = require('path');

test.describe('Color Palette Extractor', () => {

  test('file input change loads image and shows palette', async ({ page }) => {
    await page.goto('/color_palette_extractor.html');

    // Verify initial state: drop zone visible, image area hidden
    await expect(page.locator('#dropZone')).toBeVisible();
    await expect(page.locator('#imageArea')).toBeHidden();

    // Create a small test image (2x2 red/blue PNG) via canvas and upload it
    const dataTransfer = await page.evaluateHandle(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(1, 0, 1, 1);
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(0, 1, 1, 1);
      ctx.fillStyle = '#ffff00';
      ctx.fillRect(1, 1, 1, 1);

      // Convert canvas to blob synchronously via dataURL
      const dataUrl = canvas.toDataURL('image/png');
      const binary = atob(dataUrl.split(',')[1]);
      const array = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
      const file = new File([array], 'test.png', { type: 'image/png' });

      const dt = new DataTransfer();
      dt.items.add(file);
      return dt;
    });

    // Set files on the input and dispatch change event
    await page.locator('#fileInput').evaluateHandle((input, dt) => {
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, dataTransfer);

    // Wait for image to load — image area should become visible
    await expect(page.locator('#imageArea')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#dropZone')).toBeHidden();

    // Palette should be extracted and visible
    await expect(page.locator('#paletteSection')).toBeVisible({ timeout: 5000 });
    // Should have swatch cards
    const swatches = page.locator('#paletteGrid .swatch-card');
    await expect(swatches.first()).toBeVisible();
  });

  test('clicking drop zone does not double-trigger file input', async ({ page }) => {
    await page.goto('/color_palette_extractor.html');

    // Count how many 'click' events reach the file input element
    await page.evaluate(() => {
      window.__fileInputClickCount = 0;
      document.getElementById('fileInput').addEventListener('click', () => {
        window.__fileInputClickCount++;
      });
    });

    // Click the drop zone — should result in exactly 1 click on the file input
    await page.locator('#dropZone').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(100);

    const clickCount = await page.evaluate(() => window.__fileInputClickCount);
    // Bug: the native click hits the overlaying fileInput AND the dropZone handler
    // calls fileInput.click() again, resulting in 2 clicks instead of 1
    expect(clickCount).toBe(1);
  });

  test('drop zone click triggers file dialog without interference', async ({ page }) => {
    await page.goto('/color_palette_extractor.html');

    // Use Playwright's file chooser API to verify the dialog opens exactly once
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('#dropZone').click();
    const fileChooser = await fileChooserPromise;

    // Create a test image to set via the file chooser
    const testImageBuffer = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 4;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ff6600';
      ctx.fillRect(0, 0, 4, 4);
      const dataUrl = canvas.toDataURL('image/png');
      const binary = atob(dataUrl.split(',')[1]);
      const array = [];
      for (let i = 0; i < binary.length; i++) array.push(binary.charCodeAt(i));
      return array;
    });

    // Write test image to a temp file path for setFiles
    const tmpPath = path.join(__dirname, 'test_image.png');
    const fs = require('fs');
    fs.writeFileSync(tmpPath, Buffer.from(testImageBuffer));

    await fileChooser.setFiles(tmpPath);

    // Image should load successfully
    await expect(page.locator('#imageArea')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#dropZone')).toBeHidden();
    await expect(page.locator('#paletteSection')).toBeVisible({ timeout: 5000 });

    // Clean up temp file
    fs.unlinkSync(tmpPath);
  });
});

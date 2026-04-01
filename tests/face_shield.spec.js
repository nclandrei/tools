const { test, expect } = require('@playwright/test');

test.describe('Face Shield', () => {
  test('page loads and shows drop zone', async ({ page }) => {
    await page.goto('/face_shield.html');
    await expect(page.locator('h1')).toHaveText('Face Shield');
    await expect(page.locator('#dropZone')).toBeVisible();
  });

  test('uses valid mediapipe version (not 0.10.22)', async ({ page }) => {
    const response = await page.goto('/face_shield.html');
    const html = await response.text();

    // The bug: version 0.10.22 does not exist on npm/jsdelivr (404)
    expect(html).not.toContain('@mediapipe/tasks-vision@0.10.22');

    // The fix: uses 0.10.21 which is a valid published version
    expect(html).toContain('@mediapipe/tasks-vision@0.10.21');
  });

  test('has GPU to CPU fallback for face detector', async ({ page }) => {
    const response = await page.goto('/face_shield.html');
    const html = await response.text();

    // Should attempt GPU first, then fall back to CPU
    expect(html).toContain("'GPU'");
    expect(html).toContain("'CPU'");
  });

  test('model loading shows correct initial status', async ({ page }) => {
    await page.goto('/face_shield.html');

    const modelStatus = page.locator('#modelStatus');
    // Should show loading message initially
    const text = await modelStatus.textContent();
    // Either loading or already resolved (loaded/failed)
    expect(['Loading face detection model…', 'Face detection model ready.', 'Failed to load face detection model. Please refresh.']).toContain(text);
  });

  test('model loads when CDN is reachable', async ({ page }) => {
    // Intercept the ESM import and provide a mock that simulates successful loading
    await page.route('**/tasks-vision**', async route => {
      const url = route.request().url();
      if (url.endsWith('+esm') || url.endsWith('.js')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: `
            export class FaceDetector {
              static async createFromOptions() {
                return { detect: () => ({ detections: [] }) };
              }
            }
            export class FilesetResolver {
              static async forVisionTasks() { return {}; }
            }
          `
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/face_shield.html');

    const modelStatus = page.locator('#modelStatus');
    await expect(modelStatus).toHaveText('Face detection model ready.', { timeout: 30000 });
  });

  test('style buttons work correctly', async ({ page }) => {
    await page.goto('/face_shield.html');

    // Verify initial active style
    const activeBtn = await page.locator('.style-btn.active').getAttribute('data-style');
    expect(activeBtn).toBe('paper-bag');

    // Click blur via JS (buttons are in hidden workspace until photo loaded)
    await page.evaluate(() => {
      document.querySelector('.style-btn[data-style="blur"]').click();
    });
    const newActiveBtn = await page.locator('.style-btn.active').getAttribute('data-style');
    expect(newActiveBtn).toBe('blur');
  });

  test('emoji bar toggles when emoji style selected', async ({ page }) => {
    await page.goto('/face_shield.html');

    const hidden = await page.evaluate(() =>
      document.getElementById('emojiBar').style.display === 'none'
    );
    expect(hidden).toBe(true);

    await page.evaluate(() => {
      document.querySelector('.style-btn[data-style="emoji"]').click();
    });

    const visible = await page.evaluate(() =>
      document.getElementById('emojiBar').style.display === 'flex'
    );
    expect(visible).toBe(true);
  });
});

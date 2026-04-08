const { test, expect } = require('@playwright/test');

const SAMPLE_PEM = `-----BEGIN CERTIFICATE-----
MIIDazCCAlOgAwIBAgIUV/mnjFKPYhJecFGEznBTpRySi5cwDQYJKoZIhvcNAQEL
BQAwRTELMAkGA1UEBhMCVVMxEzARBgNVBAgMClNvbWUtU3RhdGUxITAfBgNVBAoM
GEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZDAeFw0yNjA0MDcyMDU3MjlaFw0yNzA0
MDcyMDU3MjlaMEUxCzAJBgNVBAYTAlVTMRMwEQYDVQQIDApTb21lLVN0YXRlMSEw
HwYDVQQKDBhJbnRlcm5ldCBXaWRnaXRzIFB0eSBMdGQwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQDOIRogP38MTC7dlKAzHjIk3MZIta77uLo6D9FTGsoe
f22QPt7jIW22PvwvSb6vzhUV5UZwPCJHJNlCmTs06lhS8TC4fvliL2M8GTIsKJqO
JIWH2x1EM2wPJxgczb3vpux3WxE3Oa23oP61bex5bj0FRJUtSW/wCwZNl9OTS8or
6uxZ+5mtIv8SMlf3XplkroKida0fsTAoQv2j+I1X7ob9bwvNyAN9VgKNLtFeBVkP
uAd8yfyXHlakIFLnFHku+2GLYX5oHMEytLs/tvOn1d+jQF9ZMFeEHtsCYJMGt8YC
Ijm5nlnYMXMFTAM7hlVO5AYls7FC7NKcdzPRiues9zeTAgMBAAGjUzBRMB0GA1Ud
DgQWBBSy7K0UbDfbQoAF8zCYFmmEL3c2HDAfBgNVHSMEGDAWgBSy7K0UbDfbQoAF
8zCYFmmEL3c2HDAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQDH
ur20CXYdel8Bivf7tWQEDtAw9bVLf2CSEPp+eLFbBeGpus2d0nGRD7gip+LsuKM0
UFyelC625JdaJ0WwIr0ZeUMgcu6Y3WYgclcw1+Nm1hNVMjFnwQHIiE1ubbAHaYwr
RjZExWT4ZuGwt3uGe2QNxgkFpc6dbvHeVnilmR4kfS3NfqECxcslteuV1s2f9O37
Avmn45suVgq0WFi6JVSxS3znQ77JvXtHS0l0EjHYBHe2oSqIuXKp9SqQE1fXepa5
5daT6Yc81hE7aH6BThquYU9AWFmKde+lNGI/SHn/GwRX3gKIxBjAV+ihRN6Rhmee
sdTwSjZcj/ZIUPuc5RJu
-----END CERTIFICATE-----`;

test.describe('Certificate Decoder', () => {

  test('page loads with correct title and header', async ({ page }) => {
    await page.goto('/certificate_decoder.html');
    await expect(page).toHaveTitle('Certificate Decoder');
    await expect(page.locator('header h1')).toHaveText('Certificate Decoder');
    expect(await page.getAttribute('header a', 'href')).toBe('/');
    await expect(page.locator('.desc')).toContainText('PEM');
  });

  test('shows error when decoding empty input', async ({ page }) => {
    await page.goto('/certificate_decoder.html');
    await page.click('#decode-btn');
    await expect(page.locator('#error-box')).toBeVisible();
    await expect(page.locator('#error-box')).toContainText('Please paste');
  });

  test('shows error for invalid PEM', async ({ page }) => {
    await page.goto('/certificate_decoder.html');
    await page.fill('#pem-input', 'not a certificate');
    await page.click('#decode-btn');
    await expect(page.locator('#error-box')).toBeVisible();
    await expect(page.locator('#error-box')).toContainText('No valid PEM');
  });

  test('load sample button decodes a certificate', async ({ page }) => {
    await page.goto('/certificate_decoder.html');
    await page.click('#sample-btn');
    await expect(page.locator('#result')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#result')).toContainText('Subject');
    await expect(page.locator('#result')).toContainText('Issuer');
    await expect(page.locator('#result')).toContainText('Validity');
  });

  test('decodes subject and issuer from pasted PEM', async ({ page }) => {
    await page.goto('/certificate_decoder.html');
    await page.fill('#pem-input', SAMPLE_PEM);
    await page.click('#decode-btn');
    await expect(page.locator('#result')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#result')).toContainText('US');
    await expect(page.locator('#result')).toContainText('Internet Widgits Pty Ltd');
  });

  test('shows validity dates and status badge', async ({ page }) => {
    await page.goto('/certificate_decoder.html');
    await page.fill('#pem-input', SAMPLE_PEM);
    await page.click('#decode-btn');
    await expect(page.locator('#result')).toBeVisible({ timeout: 10000 });
    // The sample cert is currently valid (2026-2027)
    await expect(page.locator('.badge-green')).toBeVisible();
    await expect(page.locator('.badge-green')).toContainText('Valid');
  });

  test('shows technical details including serial, algorithm, fingerprint', async ({ page }) => {
    await page.goto('/certificate_decoder.html');
    await page.fill('#pem-input', SAMPLE_PEM);
    await page.click('#decode-btn');
    await expect(page.locator('#result')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#result')).toContainText('Serial Number');
    await expect(page.locator('#result')).toContainText('SHA-256');
    await expect(page.locator('#result')).toContainText('RSA');
  });

  test('shows self-signed badge for self-signed cert', async ({ page }) => {
    await page.goto('/certificate_decoder.html');
    await page.fill('#pem-input', SAMPLE_PEM);
    await page.click('#decode-btn');
    await expect(page.locator('#result')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.badge-blue')).toBeVisible();
    await expect(page.locator('.badge-blue')).toContainText('Self-Signed');
  });

  test('shows basic constraints for CA cert', async ({ page }) => {
    await page.goto('/certificate_decoder.html');
    await page.fill('#pem-input', SAMPLE_PEM);
    await page.click('#decode-btn');
    await expect(page.locator('#result')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#result')).toContainText('Basic Constraints');
    await expect(page.locator('#result')).toContainText('CA: Yes');
  });

  test('clear button resets the form', async ({ page }) => {
    await page.goto('/certificate_decoder.html');
    await page.click('#sample-btn');
    await expect(page.locator('#result')).toBeVisible({ timeout: 10000 });
    await page.click('#clear-btn');
    await expect(page.locator('#result')).not.toBeVisible();
    await expect(page.locator('#pem-input')).toHaveValue('');
  });

  test('respects dark theme', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('theme', 'dark');
    });
    await page.goto('/certificate_decoder.html');
    const theme = await page.getAttribute('html', 'data-theme');
    expect(theme).toBe('dark');
  });

  test('respects light theme', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('theme', 'light');
    });
    await page.goto('/certificate_decoder.html');
    const theme = await page.getAttribute('html', 'data-theme');
    expect(theme).toBe('light');
  });

  test('tool card appears on index page', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('a[href="/certificate_decoder.html"]');
    await expect(card).toBeVisible();
    await expect(card.locator('.tool-title')).toContainText('Certificate Decoder');
  });
});

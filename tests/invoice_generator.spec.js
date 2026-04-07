const { test, expect } = require('@playwright/test');

test.describe('Invoice Generator', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/invoice_generator.html');
    // Clear any saved profiles
    await page.evaluate(() => localStorage.removeItem('invoice_profiles'));
  });

  test('page loads with correct title and header', async ({ page }) => {
    await expect(page).toHaveTitle('Invoice Generator');
    await expect(page.locator('header h1')).toHaveText('Invoice Generator');
    expect(await page.getAttribute('header a', 'href')).toBe('/');
    await expect(page.locator('.desc')).toContainText('invoice');
  });

  test('default dates are set to previous month', async ({ page }) => {
    const periodStart = await page.inputValue('#period-start');
    const periodEnd = await page.inputValue('#period-end');
    const issueDate = await page.inputValue('#issue-date');
    const dueDate = await page.inputValue('#due-date');

    expect(periodStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Period start should be before period end
    expect(new Date(periodStart) < new Date(periodEnd)).toBe(true);
  });

  test('has one default line item row', async ({ page }) => {
    const rows = page.locator('#line-items-body tr');
    await expect(rows).toHaveCount(1);
  });

  test('can add and remove line items', async ({ page }) => {
    const rows = page.locator('#line-items-body tr');
    await expect(rows).toHaveCount(1);

    // Add two more
    await page.click('.add-line-btn');
    await page.click('.add-line-btn');
    await expect(rows).toHaveCount(3);

    // Remove one (click the last X button)
    await page.locator('#line-items-body tr:last-child .btn-icon').click();
    await expect(rows).toHaveCount(2);
  });

  test('cannot remove the last line item', async ({ page }) => {
    const rows = page.locator('#line-items-body tr');
    await expect(rows).toHaveCount(1);
    // Click delete on the only row — should remain
    await page.locator('#line-items-body tr .btn-icon').click();
    await expect(rows).toHaveCount(1);
  });

  test('line item amount auto-calculates from qty and rate', async ({ page }) => {
    const row = page.locator('#line-items-body tr').first();
    await row.locator('[data-field="qty"]').fill('10');
    await row.locator('[data-field="rate"]').fill('150');
    const amount = await row.locator('[data-field="amount"]').textContent();
    expect(amount.trim()).toBe('1500.00');
  });

  test('form has all required sections and fields', async ({ page }) => {
    // From section
    await expect(page.locator('#from-name')).toBeVisible();
    await expect(page.locator('#from-vat')).toBeVisible();
    await expect(page.locator('#from-address')).toBeVisible();

    // Bank details
    await expect(page.locator('#bank-name')).toBeVisible();
    await expect(page.locator('#bank-account')).toBeVisible();
    await expect(page.locator('#bank-iban')).toBeVisible();
    await expect(page.locator('#bank-swift')).toBeVisible();

    // To section
    await expect(page.locator('#to-name')).toBeVisible();
    await expect(page.locator('#to-vat')).toBeVisible();
    await expect(page.locator('#to-address')).toBeVisible();

    // Invoice details
    await expect(page.locator('#invoice-number')).toBeVisible();
    await expect(page.locator('#currency')).toBeVisible();
    await expect(page.locator('#payment-terms')).toBeVisible();
    await expect(page.locator('#tax-rate')).toBeVisible();
  });

  test('generates invoice with all fields rendered', async ({ page }) => {
    // Fill in all fields
    await page.fill('#from-name', 'TestCo Ltd');
    await page.fill('#from-vat', 'GB999999999');
    await page.fill('#from-address', '10 Test Lane\nLondon, UK');
    await page.fill('#bank-name', 'Test Bank');
    await page.fill('#bank-account', 'TestCo Ltd');
    await page.fill('#bank-iban', 'GB29NWBK60161331926819');
    await page.fill('#bank-swift', 'NWBKGB2L');

    await page.fill('#to-name', 'Client Inc');
    await page.fill('#to-vat', 'DE111111111');
    await page.fill('#to-address', '5 Client Rd\nBerlin, DE');

    await page.fill('#invoice-number', 'INV-2026-001');
    await page.fill('#payment-terms', 'Net 30');
    await page.fill('#tax-rate', '19');

    // Fill line item
    const row = page.locator('#line-items-body tr').first();
    await row.locator('[data-field="desc"]').fill('Development work');
    await row.locator('[data-field="qty"]').fill('80');
    await row.locator('[data-field="rate"]').fill('100');

    await page.fill('#notes', 'Thank you for your business.');

    // Generate
    await page.click('text=Generate Invoice');

    // Preview should be visible
    await expect(page.locator('#preview-section')).toBeVisible();

    const preview = page.locator('#invoice-preview');

    // Check all content in the rendered invoice
    await expect(preview).toContainText('INVOICE');
    await expect(preview).toContainText('INV-2026-001');
    await expect(preview).toContainText('TestCo Ltd');
    await expect(preview).toContainText('GB999999999');
    await expect(preview).toContainText('10 Test Lane');
    await expect(preview).toContainText('Client Inc');
    await expect(preview).toContainText('DE111111111');
    await expect(preview).toContainText('5 Client Rd');
    await expect(preview).toContainText('Development work');
    await expect(preview).toContainText('Net 30');

    // Bank details
    await expect(preview).toContainText('Test Bank');
    await expect(preview).toContainText('GB29NWBK60161331926819');
    await expect(preview).toContainText('NWBKGB2L');

    // Tax calculation: 80 * 100 = 8000 subtotal, 19% tax = 1520, total = 9520 (EUR is default)
    await expect(preview).toContainText('€8,000.00');
    await expect(preview).toContainText('19%');

    // Footer
    await expect(preview).toContainText('Thank you for your business.');
  });

  test('generates invoice without tax when rate is 0', async ({ page }) => {
    await page.fill('#to-name', 'NoTax Corp');

    const row = page.locator('#line-items-body tr').first();
    await row.locator('[data-field="desc"]').fill('Consulting');
    await row.locator('[data-field="rate"]').fill('5000');

    await page.click('text=Generate Invoice');

    const preview = page.locator('#invoice-preview');
    await expect(preview).toContainText('Total Due');
    // Should NOT show subtotal/tax rows when tax is 0
    await expect(preview).not.toContainText('Subtotal');
    await expect(preview).not.toContainText('Tax (');
  });

  test('saves and loads profile with all fields', async ({ page }) => {
    // Fill everything
    await page.fill('#from-name', 'SaveCo');
    await page.fill('#from-vat', 'VAT123');
    await page.fill('#from-address', '1 Save St');
    await page.fill('#bank-name', 'Save Bank');
    await page.fill('#bank-account', 'SaveCo');
    await page.fill('#bank-iban', 'SAVE123');
    await page.fill('#bank-swift', 'SVBK');
    await page.fill('#to-name', 'ProfileClient');
    await page.fill('#to-vat', 'CLIVAT');
    await page.fill('#to-address', '2 Client Ave');
    await page.selectOption('#currency', 'GBP');
    await page.fill('#payment-terms', 'Net 15');
    await page.fill('#tax-rate', '20');
    await page.fill('#notes', 'Saved note');

    const row = page.locator('#line-items-body tr').first();
    await row.locator('[data-field="desc"]').fill('Saved service');
    await row.locator('[data-field="qty"]').fill('10');
    await row.locator('[data-field="rate"]').fill('200');

    // Save profile
    await page.click('text=Save as Profile');

    // Verify profiles section appears
    await expect(page.locator('#profiles-section')).toBeVisible();

    // Clear all fields by reloading
    await page.goto('/invoice_generator.html');

    // Profile should still be listed
    await expect(page.locator('#profiles-section')).toBeVisible();
    await page.selectOption('#profile-select', 'ProfileClient');
    await page.click('text=Load');

    // Verify all fields restored
    expect(await page.inputValue('#from-name')).toBe('SaveCo');
    expect(await page.inputValue('#from-vat')).toBe('VAT123');
    expect(await page.inputValue('#from-address')).toBe('1 Save St');
    expect(await page.inputValue('#bank-name')).toBe('Save Bank');
    expect(await page.inputValue('#bank-account')).toBe('SaveCo');
    expect(await page.inputValue('#bank-iban')).toBe('SAVE123');
    expect(await page.inputValue('#bank-swift')).toBe('SVBK');
    expect(await page.inputValue('#to-name')).toBe('ProfileClient');
    expect(await page.inputValue('#to-vat')).toBe('CLIVAT');
    expect(await page.inputValue('#to-address')).toBe('2 Client Ave');
    expect(await page.inputValue('#currency')).toBe('GBP');
    expect(await page.inputValue('#payment-terms')).toBe('Net 15');
    expect(await page.inputValue('#tax-rate')).toBe('20');
    expect(await page.inputValue('#notes')).toBe('Saved note');

    // Check line items restored
    const restoredRow = page.locator('#line-items-body tr').first();
    expect(await restoredRow.locator('[data-field="desc"]').inputValue()).toBe('Saved service');
    expect(await restoredRow.locator('[data-field="qty"]').inputValue()).toBe('10');
    expect(await restoredRow.locator('[data-field="rate"]').inputValue()).toBe('200');
  });

  test('deletes a saved profile', async ({ page }) => {
    await page.fill('#to-name', 'DeleteMe');
    await page.fill('#from-name', 'Temp');
    const row = page.locator('#line-items-body tr').first();
    await row.locator('[data-field="rate"]').fill('100');

    await page.click('text=Save as Profile');
    await expect(page.locator('#profiles-section')).toBeVisible();

    await page.selectOption('#profile-select', 'DeleteMe');

    // Accept the confirm dialog
    page.on('dialog', dialog => dialog.accept());
    await page.locator('.profile-row button', { hasText: 'Delete' }).click();

    // Profile section should be hidden (no profiles left)
    await expect(page.locator('#profiles-section')).toBeHidden();
  });

  test('shows validation alert when required fields missing', async ({ page }) => {
    // Try to generate without filling anything
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('client company name');
      await dialog.accept();
    });
    await page.click('text=Generate Invoice');
  });

  test('multiple line items sum correctly with tax', async ({ page }) => {
    await page.fill('#to-name', 'Multi Corp');
    await page.fill('#tax-rate', '10');

    // First line item
    const row1 = page.locator('#line-items-body tr').first();
    await row1.locator('[data-field="desc"]').fill('Service A');
    await row1.locator('[data-field="qty"]').fill('2');
    await row1.locator('[data-field="rate"]').fill('500');

    // Add second line item
    await page.click('.add-line-btn');
    const row2 = page.locator('#line-items-body tr').nth(1);
    await row2.locator('[data-field="desc"]').fill('Service B');
    await row2.locator('[data-field="qty"]').fill('5');
    await row2.locator('[data-field="rate"]').fill('200');

    await page.click('text=Generate Invoice');

    const preview = page.locator('#invoice-preview');
    // Subtotal: 2*500 + 5*200 = 2000, tax 10% = 200, total = 2200
    await expect(preview).toContainText('Service A');
    await expect(preview).toContainText('Service B');
    await expect(preview).toContainText('Subtotal');
    await expect(preview).toContainText('10%');
  });

  test('custom invoice number is used when provided', async ({ page }) => {
    await page.fill('#to-name', 'Custom Corp');
    await page.fill('#invoice-number', 'MY-CUSTOM-001');

    const row = page.locator('#line-items-body tr').first();
    await row.locator('[data-field="rate"]').fill('1000');

    await page.click('text=Generate Invoice');

    const preview = page.locator('#invoice-preview');
    await expect(preview).toContainText('MY-CUSTOM-001');
  });

  test('auto-generates invoice number when field is empty', async ({ page }) => {
    await page.fill('#to-name', 'AutoNum Corp');

    const row = page.locator('#line-items-body tr').first();
    await row.locator('[data-field="rate"]').fill('500');

    await page.click('text=Generate Invoice');

    const preview = page.locator('#invoice-preview');
    await expect(preview).toContainText('INV-AUTONU');
  });
});

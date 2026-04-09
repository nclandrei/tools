const { test, expect } = require('@playwright/test');

const SAMPLE_PROMPT = [
  '# System Instructions',
  '',
  'You are a helpful coding assistant specialized in JavaScript and TypeScript.',
  '',
  '## Guidelines',
  '',
  '- Always provide working code examples',
  '- Never fabricate API endpoints or library functions',
  '- Use TypeScript when the user\'s project uses TypeScript',
  '- IMPORTANT: Always validate user input before processing',
  '',
  '## Output Format',
  '',
  'Respond in JSON format with the following schema:',
  '```json',
  '{"explanation": "string", "code": "string", "language": "string"}',
  '```',
  '',
  '## Available Tools',
  '',
  '```json',
  '{"name": "search_docs", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}}}',
  '```',
  '',
  '## Safety',
  '',
  'Never provide harmful content. Refuse requests that could damage systems.',
  'Do not generate code that deletes user data without confirmation.',
  '',
  '## Variables',
  '',
  'The user\'s name is {{user_name}} and their project is {{project_name}}.',
  'Working directory: ${HOME}/projects',
  '',
  '## Examples',
  '',
  'Example:',
  'Input: How do I sort an array?',
  'Output: Use Array.prototype.sort()',
  '',
  'Example:',
  'Input: What is a closure?',
  'Output: A closure is a function that captures variables from its enclosing scope.',
  '',
  'Always provide working code examples',
  '',
  '<context>',
  'This is additional context provided at runtime.',
  '</context>',
].join('\n');

test.describe('Prompt Inspector', () => {

  test('page loads with correct title and header', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await expect(page).toHaveTitle('Prompt Inspector');
    await expect(page.locator('header h1')).toHaveText('Prompt Inspector');
    expect(await page.getAttribute('header a', 'href')).toBe('/');
    await expect(page.locator('.desc')).toContainText('system prompt');
  });

  test('shows empty state initially', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await expect(page.locator('#emptyState')).toBeVisible();
    await expect(page.locator('#emptyState')).toContainText('Paste or type');
  });

  test('load sample button populates textarea and shows results', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await page.click('#btnSample');
    await expect(page.locator('#input')).not.toHaveValue('');
    await expect(page.locator('#card-size')).toBeVisible();
    await expect(page.locator('#card-patterns')).toBeVisible();
    await expect(page.locator('#card-structure')).toBeVisible();
  });

  test('clear button resets everything', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await page.click('#btnSample');
    await expect(page.locator('#card-size')).toBeVisible();
    await page.click('#btnClear');
    await expect(page.locator('#input')).toHaveValue('');
    await expect(page.locator('#emptyState')).toBeVisible();
  });

  test('typing text triggers live analysis', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await page.fill('#input', 'You are a helpful assistant. Always respond in JSON format.');
    // Wait for debounce
    await page.waitForSelector('#card-size', { timeout: 2000 });
    await expect(page.locator('#card-size')).toBeVisible();
  });

  test('shows correct word and token counts', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await page.fill('#input', 'The quick brown fox jumps over the lazy dog');
    await page.waitForSelector('#card-size', { timeout: 2000 });
    // 9 words
    const sizeCard = page.locator('#card-size');
    await expect(sizeCard).toContainText('9');
    await expect(sizeCard).toContainText('words');
    await expect(sizeCard).toContainText('tokens');
  });

  test('shows context window percentage bar', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await page.click('#btnSample');
    await expect(page.locator('.bar-track')).toBeVisible();
    await expect(page.locator('.bar-fill')).toBeVisible();
    // Should show percentage text
    await expect(page.locator('#card-size')).toContainText('%');
  });

  test('model selector changes context window calculation', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await page.click('#btnSample');
    await page.waitForSelector('#modelSelect', { timeout: 2000 });
    // Get initial percentage text
    const initialText = await page.locator('#card-size').textContent();
    // Switch to a model with different context window
    await page.selectOption('#modelSelect', 'gemini-pro');
    await page.waitForTimeout(300);
    const newText = await page.locator('#card-size').textContent();
    // The percentage should be different (gemini has 1M context vs claude 200k)
    expect(newText).not.toBe(initialText);
  });

  test('shows cost estimates for all models', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await page.click('#btnSample');
    await expect(page.locator('.cost-grid')).toBeVisible();
    // Should show multiple model cost items
    const costItems = page.locator('.cost-item');
    await expect(costItems).toHaveCount(8);
    // Each should have a dollar amount
    await expect(costItems.first()).toContainText('$');
  });

  test('detects patterns in sample prompt', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await page.click('#btnSample');
    const patternsCard = page.locator('#card-patterns');
    await expect(patternsCard).toBeVisible();
    // Sample has: role, few-shot, tools, guardrails, output format
    await expect(patternsCard.locator('.pill.pattern')).toHaveCount(5);
  });

  test('shows heading outline', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await page.click('#btnSample');
    const structureCard = page.locator('#card-structure');
    await expect(structureCard).toBeVisible();
    await expect(structureCard.locator('.outline li')).not.toHaveCount(0);
    // Should contain H1 and H2 headings
    await expect(structureCard).toContainText('System Instructions');
    await expect(structureCard).toContainText('Guidelines');
  });

  test('detects XML tags', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await page.click('#btnSample');
    const xmlCard = page.locator('#card-xml');
    await expect(xmlCard).toBeVisible();
    await expect(xmlCard).toContainText('context');
  });

  test('detects variables and placeholders', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await page.click('#btnSample');
    const varsCard = page.locator('#card-variables');
    await expect(varsCard).toBeVisible();
    await expect(varsCard).toContainText('{{user_name}}');
    await expect(varsCard).toContainText('{{project_name}}');
    await expect(varsCard).toContainText('${HOME}');
  });

  test('shows instruction density', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await page.click('#btnSample');
    const instrCard = page.locator('#card-instructions');
    await expect(instrCard).toBeVisible();
    await expect(instrCard).toContainText('directives');
    await expect(instrCard).toContainText('sentences');
    // Should show percentage
    await expect(instrCard).toContainText('%');
  });

  test('shows readability score', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await page.click('#btnSample');
    const readCard = page.locator('#card-readability');
    await expect(readCard).toBeVisible();
    await expect(readCard).toContainText('Flesch-Kincaid');
    // Should show a label like "Standard" or "Difficult"
    await expect(readCard.locator('.readability-meta .label')).not.toHaveText('N/A');
  });

  test('shows markdown elements', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await page.click('#btnSample');
    const mdCard = page.locator('#card-markdown');
    await expect(mdCard).toBeVisible();
    await expect(mdCard).toContainText('code blocks');
    await expect(mdCard).toContainText('list items');
  });

  test('detects duplicate lines', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await page.click('#btnSample');
    // Sample has "Always provide working code examples" duplicated
    const dupeCard = page.locator('#card-duplicates');
    await expect(dupeCard).toBeVisible();
    await expect(dupeCard).toContainText('Always provide working code examples');
  });

  test('no results cards for empty non-whitespace input after clear', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await page.click('#btnSample');
    await expect(page.locator('#card-size')).toBeVisible();
    await page.click('#btnClear');
    await expect(page.locator('#card-size')).not.toBeVisible();
    await expect(page.locator('#card-patterns')).not.toBeVisible();
  });

  test('char count updates in footer', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await page.fill('#input', 'Hello world');
    await page.waitForTimeout(300);
    await expect(page.locator('#charCount')).toContainText('11');
  });

  test('respects dark theme', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('theme', 'dark');
    });
    await page.goto('/prompt_inspector.html');
    const theme = await page.getAttribute('html', 'data-theme');
    expect(theme).toBe('dark');
  });

  test('respects light theme', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('theme', 'light');
    });
    await page.goto('/prompt_inspector.html');
    const theme = await page.getAttribute('html', 'data-theme');
    expect(theme).toBe('light');
  });

  test('tool card appears on index page', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('a[href="/prompt_inspector.html"]');
    await expect(card).toBeVisible();
    await expect(card.locator('.tool-title')).toContainText('Prompt Inspector');
  });

  test('handles prompt with no patterns gracefully', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    await page.fill('#input', 'The weather is nice today. Birds are singing in the trees.');
    await page.waitForSelector('#card-size', { timeout: 2000 });
    // Should still show size and instruction cards
    await expect(page.locator('#card-size')).toBeVisible();
    await expect(page.locator('#card-instructions')).toBeVisible();
    // Patterns should all be off
    const patternOff = page.locator('#card-patterns .pill.pattern-off');
    await expect(patternOff).toHaveCount(5);
    // No XML, variables, duplicates, or markdown cards
    await expect(page.locator('#card-xml')).not.toBeVisible();
    await expect(page.locator('#card-variables')).not.toBeVisible();
    await expect(page.locator('#card-duplicates')).not.toBeVisible();
  });

  test('handles very long prompt without crashing', async ({ page }) => {
    await page.goto('/prompt_inspector.html');
    // Generate a large prompt (~50k chars)
    const longPrompt = ('# Instructions\n\nYou are a helpful assistant.\n\n' + 'Please follow all rules carefully. '.repeat(1500));
    await page.fill('#input', longPrompt);
    await page.waitForSelector('#card-size', { timeout: 5000 });
    await expect(page.locator('#card-size')).toBeVisible();
    // Token count should be in the thousands
    const sizeText = await page.locator('#card-size').textContent();
    expect(sizeText).toMatch(/\d/);
  });
});

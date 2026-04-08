const { test, expect } = require('@playwright/test');

const PORT = 8093;
let server;

test.beforeAll(async () => {
  const { exec } = require('child_process');
  server = exec(`python3 -m http.server ${PORT}`, { cwd: '/home/user/tools' });
  // Wait for server to start
  await new Promise(r => setTimeout(r, 1000));
});

test.afterAll(async () => {
  if (server) server.kill();
});

const URL = `http://127.0.0.1:${PORT}/iptables_visualizer.html`;

test.describe('iptables Visualizer', () => {

  test('page loads with correct title and header', async ({ page }) => {
    await page.goto(URL);
    await expect(page).toHaveTitle('iptables Visualizer');
    await expect(page.locator('header h1')).toHaveText('iptables Visualizer');
    await expect(page.locator('header a[href="/"]')).toBeVisible();
  });

  test('has format tabs, textarea, and action buttons', async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('.format-tab')).toHaveCount(2);
    await expect(page.locator('.format-tab.active')).toHaveText('iptables-save');
    await expect(page.locator('#rules-input')).toBeVisible();
    await expect(page.locator('#parse-btn')).toBeVisible();
  });

  test('format tabs switch correctly', async ({ page }) => {
    await page.goto(URL);
    await page.click('.format-tab[data-fmt="list"]');
    await expect(page.locator('.format-tab[data-fmt="list"]')).toHaveClass(/active/);
    await expect(page.locator('.format-tab[data-fmt="save"]')).not.toHaveClass(/active/);
    // Switch back
    await page.click('.format-tab[data-fmt="save"]');
    await expect(page.locator('.format-tab[data-fmt="save"]')).toHaveClass(/active/);
  });

  test('load basic-save sample and visualize', async ({ page }) => {
    await page.goto(URL);
    await page.selectOption('#sample-select', 'basic-save');

    // Should auto-parse: stats bar visible
    await expect(page.locator('.stats-bar')).toBeVisible();
    // Should show rule count badges
    await expect(page.locator('.stat-badge').first()).toBeVisible();
    // Should render filter table
    await expect(page.locator('.table-section[data-table="filter"]')).toBeVisible();
    // Should have chain blocks
    await expect(page.locator('.chain-block')).toHaveCount(3); // INPUT, FORWARD, OUTPUT
    // INPUT chain should have rules
    const inputRules = page.locator('.chain-block').first().locator('.rule-row');
    await expect(inputRules).not.toHaveCount(0);
  });

  test('load nat-save sample and visualize multiple tables', async ({ page }) => {
    await page.goto(URL);
    await page.selectOption('#sample-select', 'nat-save');

    // Should have both nat and filter tables
    await expect(page.locator('.table-section')).toHaveCount(2);
    await expect(page.locator('.table-section[data-table="nat"]')).toBeVisible();
    await expect(page.locator('.table-section[data-table="filter"]')).toBeVisible();
    // Flow diagram should exist
    await expect(page.locator('.flow-section')).toBeVisible();
  });

  test('load basic-list sample and visualize', async ({ page }) => {
    await page.goto(URL);
    await page.selectOption('#sample-select', 'basic-list');

    // Should switch to list format tab
    await expect(page.locator('.format-tab[data-fmt="list"]')).toHaveClass(/active/);
    // Should render stats and chains
    await expect(page.locator('.stats-bar')).toBeVisible();
    await expect(page.locator('.chain-block')).toHaveCount(3);
  });

  test('manual paste and visualize iptables-save rules', async ({ page }) => {
    await page.goto(URL);
    const rules = `*filter
:INPUT ACCEPT [0:0]
:FORWARD DROP [0:0]
:OUTPUT ACCEPT [0:0]
-A INPUT -p tcp --dport 22 -j ACCEPT
-A INPUT -p tcp --dport 80 -j ACCEPT
-A FORWARD -j DROP
COMMIT`;
    await page.fill('#rules-input', rules);
    await page.click('#parse-btn');

    await expect(page.locator('.stats-bar')).toBeVisible();
    await expect(page.locator('.table-section[data-table="filter"]')).toBeVisible();
    // 3 rules total
    const statNums = page.locator('.stat-badge .stat-num').first();
    await expect(statNums).toHaveText('3');
  });

  test('clear button resets output', async ({ page }) => {
    await page.goto(URL);
    await page.selectOption('#sample-select', 'basic-save');
    await expect(page.locator('.stats-bar')).toBeVisible();

    await page.click('button:has-text("Clear")');
    await expect(page.locator('.stats-bar')).not.toBeVisible();
    await expect(page.locator('#rules-input')).toHaveValue('');
  });

  test('empty input shows error on visualize', async ({ page }) => {
    await page.goto(URL);
    await page.click('#parse-btn');
    await expect(page.locator('.empty-state')).toBeVisible();
  });

  test('rule targets are color-coded correctly', async ({ page }) => {
    await page.goto(URL);
    await page.selectOption('#sample-select', 'basic-save');

    // ACCEPT rules should have the accept class
    const acceptTargets = page.locator('.rule-target.accept');
    await expect(acceptTargets.first()).toBeVisible();

    // DROP rules should have the drop class
    const dropTargets = page.locator('.rule-target.drop');
    await expect(dropTargets.first()).toBeVisible();

    // LOG rules should have the log class
    const logTargets = page.locator('.rule-target.log');
    await expect(logTargets.first()).toBeVisible();
  });

  test('chain policies are displayed with correct styling', async ({ page }) => {
    await page.goto(URL);
    await page.selectOption('#sample-select', 'basic-save');

    // INPUT chain has DROP policy
    const dropPolicy = page.locator('.chain-policy.drop');
    await expect(dropPolicy.first()).toBeVisible();
    await expect(dropPolicy.first()).toHaveText('DROP');

    // OUTPUT chain has ACCEPT policy
    const acceptPolicy = page.locator('.chain-policy.accept');
    await expect(acceptPolicy.first()).toBeVisible();
  });

  test('table sections can be collapsed and expanded', async ({ page }) => {
    await page.goto(URL);
    await page.selectOption('#sample-select', 'basic-save');

    const tableHeader = page.locator('.table-header').first();
    const tableBody = page.locator('.table-body').first();

    // Initially visible
    await expect(tableBody).toBeVisible();

    // Collapse
    await tableHeader.click();
    await expect(tableBody).not.toBeVisible();

    // Expand
    await tableHeader.click();
    await expect(tableBody).toBeVisible();
  });

  test('packet flow diagram renders', async ({ page }) => {
    await page.goto(URL);
    await page.selectOption('#sample-select', 'basic-save');

    await expect(page.locator('.flow-section')).toBeVisible();
    await expect(page.locator('.flow-diagram')).toHaveCount(4);
    // Should have flow nodes (at least Packet In and Routing Decision)
    const nodes = page.locator('.flow-node');
    const count = await nodes.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('light theme applies correct styles', async ({ page }) => {
    await page.goto(URL);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
      localStorage.setItem('theme', 'light');
    });
    await page.selectOption('#sample-select', 'basic-save');

    const body = page.locator('body');
    const bg = await body.evaluate(el => getComputedStyle(el).backgroundColor);
    // Light theme background should be light
    expect(bg).toMatch(/rgba?\(250, 250, 248/);
  });

  test('dark theme applies correct styles', async ({ page }) => {
    await page.goto(URL);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
      localStorage.setItem('theme', 'dark');
    });
    await page.selectOption('#sample-select', 'basic-save');

    const body = page.locator('body');
    const bg = await body.evaluate(el => getComputedStyle(el).backgroundColor);
    // Dark theme background should be dark
    expect(bg).toMatch(/rgba?\(17, 17, 19/);
  });

  test('Ctrl+Enter triggers parse', async ({ page }) => {
    await page.goto(URL);
    const rules = `*filter
:INPUT ACCEPT [0:0]
:OUTPUT ACCEPT [0:0]
:FORWARD ACCEPT [0:0]
-A INPUT -p tcp --dport 443 -j ACCEPT
COMMIT`;
    await page.fill('#rules-input', rules);
    await page.locator('#rules-input').press('Control+Enter');

    await expect(page.locator('.stats-bar')).toBeVisible();
  });

  test('hover on rule row shows raw rule in tooltip', async ({ page }) => {
    await page.goto(URL);
    await page.selectOption('#sample-select', 'basic-save');

    const firstRule = page.locator('.rule-row[title]').first();
    const title = await firstRule.getAttribute('title');
    expect(title).toBeTruthy();
    expect(title.length).toBeGreaterThan(0);
  });

  test('custom chains are parsed from iptables-save', async ({ page }) => {
    await page.goto(URL);
    await page.selectOption('#sample-select', 'nat-save');

    // DOCKER-USER is a custom chain in the nat-save sample
    const chainNames = page.locator('.chain-name');
    const allNames = await chainNames.allTextContents();
    expect(allNames).toContain('DOCKER-USER');
  });
});

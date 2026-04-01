const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 120000,
  use: {
    baseURL: 'http://127.0.0.1:8091',
  },
  webServer: {
    command: 'python3 -m http.server 8091',
    port: 8091,
    reuseExistingServer: true,
  },
});

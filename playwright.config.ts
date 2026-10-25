import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  workers: 2,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173/record-tracker/",
    browserName: "chromium",
    timezoneId: "Asia/Seoul",
    viewport: { width: 1200, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173 --strictPort --configLoader runner",
    url: "http://127.0.0.1:4173/record-tracker/",
    reuseExistingServer: false,
  },
});

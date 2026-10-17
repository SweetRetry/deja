import { defineConfig, devices } from "@playwright/test";

const PORT = 5273;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // The real Rust backend: same dispatch the Tauri command calls.
      command: "npm run e2e:api",
      url: "http://127.0.0.1:5177/api/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${PORT} --strictPort`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});

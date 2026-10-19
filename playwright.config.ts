import { defineConfig, devices } from "@playwright/test";
import { SCRATCH_TRASH } from "./e2e/scratch-trash";

const PORT = 5273;
/** `npm run e2e:slow` sets this for a loaded machine or a slow CI box. */
const SLOW = process.env.DEJA_E2E_SLOW === "1";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: SLOW ? 90_000 : 30_000,
  expect: { timeout: SLOW ? 20_000 : 5_000 },
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
      env: { DEJA_TRASH_DIR: SCRATCH_TRASH },
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

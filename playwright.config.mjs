import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:8788",
  },
  webServer: {
    command: "node e2e/serve.mjs",
    url: "http://localhost:8788/index.html",
    reuseExistingServer: !process.env.CI,
  },
});

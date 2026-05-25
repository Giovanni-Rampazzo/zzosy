import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright config — E2E tests do ZZOSY.
 *
 * Roda contra um dev server (npm run dev) ou prod build (npm start).
 * BASE_URL pode ser override pra testar staging/prod.
 *
 * Local:
 *   npm run dev       # tab 1
 *   npm run test:e2e  # tab 2
 *
 * CI (futuro):
 *   webServer config abaixo spin up automatico se quiser auto-start.
 *   Por ora deixei desligado pra teste local mais rapido (assume dev server
 *   ja rodando).
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Adicionar firefox/webkit quando quiser cobertura multi-browser:
    // { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    // { name: "webkit",  use: { ...devices["Desktop Safari"]  } },
  ],

  // webServer: { command: "npm run dev", url: BASE_URL, reuseExistingServer: true },
})

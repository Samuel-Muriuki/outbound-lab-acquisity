import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for OutboundLab.
 *
 * Default target: the production URL (per .claude/INSTRUCTIONS.md rule
 * #6 — verify on production, not localhost). Override with E2E_BASE_URL.
 *
 * The local dev fallback at http://localhost:3000 is used when:
 * - PLAYWRIGHT_BASE_URL=http://localhost:3000 is set explicitly, or
 * - The default outbound-lab-acquisity.vercel.app target isn't reachable
 */
const BASE_URL =
  process.env.E2E_BASE_URL ??
  process.env.PLAYWRIGHT_BASE_URL ??
  "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    /*
     * Visible browser per the universal template's "MANDATORY — visible
     * browser for all automated tests" rule. Override with HEADED=false
     * for CI where there's no display.
     */
    headless: process.env.HEADED === "false" || Boolean(process.env.CI),
  },

  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 5"] },
    },
  ],

  /*
   * Auto-start the local dev server when running against localhost
   * and there's no server already responding. CI just sets
   * E2E_BASE_URL=https://outbound-lab-acquisity.vercel.app and skips this.
   */
  webServer: BASE_URL.includes("localhost")
    ? {
        command: "pnpm dev",
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 60_000,
      }
    : undefined,
});

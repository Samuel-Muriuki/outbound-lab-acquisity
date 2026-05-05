/**
 * Phase 1 quality-gate smoke spec.
 *
 * Verifies the landing page loads end-to-end with every element the
 * brand spec calls out. Doesn't exercise the research flow (that
 * requires API keys + a live Supabase connection — covered by the
 * `acquisity.ai` integration test in tests/integration/agent-1.test.ts).
 *
 * Tagged @phase1 so CI can run a subset:
 *   pnpm test:e2e -- --grep "@phase1"
 */
import { expect, test } from "@playwright/test";

test.describe("OutboundLab landing — Phase 1 smoke @phase1", () => {
  test("loads with hero, URL input, and 'Try it on Acquisity' preset", async ({
    page,
  }) => {
    await page.goto("/");

    // Header: gradient dot + wordmark.
    // Note: the <header> here is nested inside <main>, so per the ARIA
    // spec it does NOT carry the implicit `banner` landmark role
    // (banner only applies to <header> as a direct child of <body>).
    // We locate by element selector + the wordmark text instead.
    await expect(
      page.locator("header").getByText("OutboundLab")
    ).toBeVisible();

    // H1
    await expect(
      page.getByRole("heading", { level: 1, name: "OutboundLab" })
    ).toBeVisible();

    // Subhead + body
    await expect(
      page.getByText("Multi-agent B2B research, on demand.")
    ).toBeVisible();
    await expect(page.getByText("Paste any company URL.")).toBeVisible();

    // URL input + Research button
    await expect(
      page.getByPlaceholder("https://acquisity.ai")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /research/i })).toBeVisible();

    // Preset trigger
    await expect(
      page.getByRole("button", { name: /Try it on Acquisity/i })
    ).toBeVisible();
  });

  test("inline error appears on invalid URL submit", async ({ page }) => {
    await page.goto("/");
    const input = page.getByPlaceholder("https://acquisity.ai");
    // 127.0.0.1 reliably trips the private-hostname refine (the
    // browser URL parser would otherwise auto-recover from many other
    // malformed inputs, e.g. it strips spaces and re-parses, hiding
    // the validation error we want to assert against).
    await input.fill("127.0.0.1");
    await page.getByRole("button", { name: /research/i }).click();

    await expect(
      page.getByText(/Cannot research private or local addresses/i)
    ).toBeVisible();
  });

  test("'/' keyboard shortcut focuses the URL input", async ({ page }) => {
    await page.goto("/");
    // Move focus off the input to start with
    await page.locator("body").click();
    await page.keyboard.press("/");
    await expect(page.getByPlaceholder("https://acquisity.ai")).toBeFocused();
  });

  test("non-existent run id renders the branded 404 page", async ({ page }) => {
    await page.goto("/research/00000000-0000-0000-0000-000000000000");
    await expect(
      page.getByRole("heading", { name: /We couldn't find that\./i })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Back to OutboundLab/i })).toBeVisible();
  });
});

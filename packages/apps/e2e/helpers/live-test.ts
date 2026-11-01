// `test` for the live tier (#1677). Every live spec imports it instead of
// `@playwright/test`, so each test starts with the full request budget of its
// accounts (600 per minute in `WgwApiRateLimiters`).
//
// The tier runs every test as the same two seeded accounts. Back-to-back
// tests each boot the app in a fresh browser, so a minute of short tests
// spends more than one person would, and a later test meets 429s it did not
// cause. The production limit stays as it is: a test that spends the whole
// budget by itself still fails, with a message that says so.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base } from "@playwright/test";
import { E2E_USERNAME } from "./notes-live";

// Everything else (`expect`, types) comes from Playwright unchanged; the local `test` wins.
export * from "@playwright/test";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
/** The second login `wgw:dev-install` seeds; two-user specs sign in as it. */
const TEAMMATE = process.env.WGW_E2E_TEAMMATE ?? "member";
const apiPackage = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../api");

type BudgetReport = { limit: number; used: Record<string, number> };

/** The reset runs `artisan` on this machine, so it only applies to a local API. */
function apiIsLocal(): boolean {
  const host = new URL(API).hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

/** Clears the accounts' budgets and returns what they had spent in the current window. */
function resetApiBudget(): BudgetReport {
  const out = execFileSync("php", ["artisan", "wgw:e2e-reset-api-budget", E2E_USERNAME, TEAMMATE], {
    cwd: apiPackage,
    encoding: "utf8",
  });
  return JSON.parse(out.trim().split("\n").at(-1) ?? "") as BudgetReport;
}

/** Accounts that reached the limit in the test's last minute window. */
function accountsOverBudget(report: BudgetReport): string[] {
  return Object.entries(report.used)
    .filter(([, used]) => used >= report.limit)
    .map(([account]) => account);
}

export const test = base.extend<{ freshApiBudget: void }>({
  freshApiBudget: [
    // Playwright reads the fixture's dependencies from the first argument.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      if (!apiIsLocal()) {
        await use();
        return;
      }
      resetApiBudget();
      await use();
      const report = resetApiBudget();
      const over = accountsOverBudget(report);
      if (over.length > 0) {
        throw new Error(
          `${over.join(", ")} used the whole API budget (${report.limit} requests per minute) ` +
            "within this test, so the app got 429 responses. The test or the app sends too many requests.",
        );
      }
    },
    { auto: true },
  ],
});

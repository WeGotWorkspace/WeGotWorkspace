// Settings → Calendar → Availability (#1912), live app and API.
//
// - A save in one tab reaches another open tab without a reload (BroadcastChannel).
// - The state comes back from the server after a reload.
// - Save while offline shows the offline toast and sends no PUT.
import { expect, test } from "./helpers/live-test";
import { openCalendarWeek } from "./helpers/calendar-live";
import type { Locator, Page } from "@playwright/test";

const SWITCH_LABEL = "Share my availability with my Teams";
const SAVED_TOAST = "Availability settings saved";
const OFFLINE_TOAST = "Availability settings need a connection. Try again when you are online.";

async function openAvailabilityDialog(page: Page): Promise<Locator> {
  await page.locator(".workspace-sidebar-account-footer__settings-button").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("switch", { name: SWITCH_LABEL })).toBeVisible({
    timeout: 20_000,
  });
  return dialog;
}

/** The first personal calendar row: Team rows have no "Teammates see" select. */
function personalRow(dialog: Locator, name?: string): Locator {
  const rows = dialog
    .locator("li.settings-availability__calendar")
    .filter({ has: dialog.page().locator(".settings-availability__detail-select") });
  return name ? rows.filter({ hasText: name }).first() : rows.first();
}

async function saveFromFooter(dialog: Locator): Promise<void> {
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
}

test.describe("Settings → Calendar availability (live app)", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a save reaches a second tab, survives a reload, and offline Save sends nothing", async ({
    page: tabA,
  }) => {
    const tabB = await tabA.context().newPage();
    let dialogA: Locator | undefined;
    try {
      await openCalendarWeek(tabA);
      dialogA = await openAvailabilityDialog(tabA);
      const switchA = dialogA.getByRole("switch", { name: SWITCH_LABEL });
      // The account starts from the default: sharing off.
      await expect(switchA).not.toBeChecked();
      await switchA.click();
      await expect(switchA).toBeChecked();
      const calendarName =
        (
          await personalRow(dialogA).locator(".settings-availability__calendar-label").textContent()
        )?.trim() ?? "";
      expect(calendarName).not.toBe("");

      // Tab B shows the saved state, so the dialog is open there before tab A saves.
      await openCalendarWeek(tabB);
      const dialogB = await openAvailabilityDialog(tabB);
      await expect(dialogB.getByRole("switch", { name: SWITCH_LABEL })).not.toBeChecked();

      const includeA = personalRow(dialogA, calendarName).getByRole("checkbox");
      await expect(includeA).toBeChecked();
      await includeA.click();
      await expect(includeA).not.toBeChecked();
      await saveFromFooter(dialogA);
      await expect(tabA.getByText(SAVED_TOAST)).toBeVisible({ timeout: 15_000 });

      // Tab B, no reload.
      await expect(dialogB.getByRole("switch", { name: SWITCH_LABEL })).toBeChecked({
        timeout: 20_000,
      });
      const rowB = personalRow(dialogB, calendarName);
      await expect(rowB.getByRole("checkbox")).not.toBeChecked();
      await expect(rowB.getByRole("combobox")).toBeDisabled();

      // Tab A after a reload: the server holds the state.
      await tabA.reload();
      await openCalendarWeek(tabA);
      dialogA = await openAvailabilityDialog(tabA);
      await expect(dialogA.getByRole("switch", { name: SWITCH_LABEL })).toBeChecked();
      await expect(personalRow(dialogA, calendarName).getByRole("checkbox")).not.toBeChecked();

      // Offline: the edit is refused and no request leaves.
      const puts: string[] = [];
      tabA.on("request", (request) => {
        if (
          request.method() === "PUT" &&
          request.url().includes("/api/v1/calendars/availability")
        ) {
          puts.push(request.url());
        }
      });
      await tabA.context().setOffline(true);
      await personalRow(dialogA, calendarName).getByRole("checkbox").click();
      await expect(personalRow(dialogA, calendarName).getByRole("checkbox")).toBeChecked();
      await saveFromFooter(dialogA);
      await expect(tabA.getByText(OFFLINE_TOAST)).toBeVisible({ timeout: 15_000 });
      expect(puts).toEqual([]);
      await tabA.context().setOffline(false);

      // The offline edit was not stored.
      await tabA.reload();
      await openCalendarWeek(tabA);
      dialogA = await openAvailabilityDialog(tabA);
      await expect(personalRow(dialogA, calendarName).getByRole("checkbox")).not.toBeChecked();
    } finally {
      await tabA.context().setOffline(false);
      // Back to the default state for the other live specs.
      try {
        if (!dialogA || !(await dialogA.isVisible().catch(() => false))) {
          await tabA.reload();
          await openCalendarWeek(tabA);
          dialogA = await openAvailabilityDialog(tabA);
        }
        const sw = dialogA.getByRole("switch", { name: SWITCH_LABEL });
        if (await sw.isChecked()) {
          const rows = dialogA
            .locator("li.settings-availability__calendar")
            .filter({ has: tabA.locator(".settings-availability__detail-select") });
          const boxes = rows.getByRole("checkbox");
          for (let i = 0; i < (await boxes.count()); i++) {
            if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).click();
          }
          await sw.click();
          await saveFromFooter(dialogA);
          await expect(tabA.getByText(SAVED_TOAST).last()).toBeVisible({ timeout: 15_000 });
        }
      } finally {
        await tabB.close();
      }
    }
  });
});

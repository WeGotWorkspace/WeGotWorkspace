// Availability settings across two tabs and offline (#1912).
//
// The settings live on the server and have no push. Tab A saves through the
// Calendar → Settings dialog footer; tab B, open on Settings → Calendar, must
// follow without a reload (BroadcastChannel). A reload reads the same state
// back from the server. Saving while offline shows an error toast and sends
// nothing, so the offline edit is not stored.
import { openCalendarWeek } from "./helpers/calendar-live";
import { expect, test, type Page } from "./helpers/live-test";
import { api, openUser, OWNER, setTabOffline, type Tab } from "./helpers/live-matrix";

type AvailabilityCalendar = {
  calendarId: string;
  name: string;
  source: "personal" | "team";
};

const SWITCH = "Share my availability with my Teams";
const SAVED = "Availability settings saved";
const SAVE_OFFLINE = "Availability settings need a connection. Try again when you are online.";

async function loadSettings(): Promise<{ enabled: boolean; calendars: AvailabilityCalendar[] }> {
  const res = await api(OWNER, "GET", "/calendars/availability");
  expect(res.status, "GET /calendars/availability").toBe(200);
  return res.json as { enabled: boolean; calendars: AvailabilityCalendar[] };
}

/** Back to the defaults, so other live specs start with the switch off. */
async function resetSettings(calendarId: string): Promise<void> {
  const res = await api(OWNER, "PUT", "/calendars/availability", {
    enabled: false,
    calendars: [{ calendarId, include: true, detail: "busy" }],
  });
  expect(res.status, "PUT /calendars/availability").toBe(200);
}

async function openCalendarSettingsDialog(page: Page) {
  await openCalendarWeek(page);
  await page.locator(".app-sidebar").getByText("Settings", { exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("switch", { name: SWITCH })).toBeVisible();
  return dialog;
}

test.describe("Availability settings in two tabs and offline", () => {
  let calendar: AvailabilityCalendar;

  test.beforeAll(async () => {
    const settings = await loadSettings();
    const personal = settings.calendars.find((c) => c.source === "personal");
    if (!personal) throw new Error("the live user has no personal event calendar");
    calendar = personal;
    await resetSettings(calendar.calendarId);
  });

  test.afterAll(async () => {
    if (calendar) await resetSettings(calendar.calendarId);
  });

  test("a save in one tab shows in the other; an offline save sends nothing", async ({
    browser,
  }) => {
    const context = await openUser(browser, OWNER);
    const tabA = (await context.newPage()) as Tab;
    const tabB = (await context.newPage()) as Tab;
    const include = `Counts toward my availability ${calendar.name}`;
    const detail = `Teammates see ${calendar.name}`;

    // Tab B: Settings → Calendar, switch off.
    await tabB.goto("/settings/calendar");
    await expect(tabB.getByRole("switch", { name: SWITCH })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    // Tab A: turn on, uncheck the calendar, save with the dialog footer.
    let dialog = await openCalendarSettingsDialog(tabA);
    await dialog.getByRole("switch", { name: SWITCH }).click();
    await dialog.getByRole("checkbox", { name: include }).click();
    await expect(dialog.getByRole("combobox", { name: detail })).toBeDisabled();
    await dialog.getByRole("button", { name: "Save" }).last().click();
    await expect(tabA.getByText(SAVED).first()).toBeVisible();

    // Tab B follows without a reload.
    await expect(tabB.getByRole("switch", { name: SWITCH })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(tabB.getByRole("checkbox", { name: include })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(tabB.getByRole("combobox", { name: detail })).toBeDisabled();

    // A reload reads the same state back from the server.
    dialog = await openCalendarSettingsDialog(tabA);
    await expect(dialog.getByRole("switch", { name: SWITCH })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(dialog.getByRole("checkbox", { name: include })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    // Offline: Save shows the error toast and sends no write.
    const writes: string[] = [];
    tabA.on("request", (request) => {
      if (request.url().includes("/calendars/availability") && request.method() !== "GET") {
        writes.push(`${request.method()} ${request.url()}`);
      }
    });
    await setTabOffline(tabA, true);
    await dialog.getByRole("checkbox", { name: include }).click();
    await dialog.getByRole("button", { name: "Save" }).last().click();
    await expect(tabA.getByText(SAVE_OFFLINE).first()).toBeVisible();
    expect(writes, "no availability write while offline").toEqual([]);

    // Back online, a reload shows the offline edit was not stored.
    await setTabOffline(tabA, false);
    dialog = await openCalendarSettingsDialog(tabA);
    await expect(dialog.getByRole("checkbox", { name: include })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    const stored = await loadSettings();
    expect(stored.enabled).toBe(true);
    expect(stored.calendars.find((c) => c.calendarId === calendar.calendarId)).toMatchObject({
      include: false,
    });

    await context.close();
  });
});

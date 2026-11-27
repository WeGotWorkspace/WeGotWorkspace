// Public availability link (#2406): turn it on in Settings → Calendar, subscribe to it as a
// stranger (no cookies, no token), make a new link, turn it off.
//
// The feed is public, so it is read with a plain fetch: nothing from the signed-in browser
// goes with it. It must hold only "Busy" blocks (no title), and the old link must show nothing
// as soon as it is replaced or turned off.
import { expect, test } from "./helpers/live-test";
import { api, openUser, OWNER, type Tab } from "./helpers/live-matrix";

const TITLE = "E2E secret salary talk";
const LINK = "/calendars/availability/public-link";

type PublicLink = { enabled: boolean; httpsUrl?: string };

async function stranger(url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { headers: { Accept: "text/calendar" } });
  return { status: res.status, body: await res.text() };
}

async function createBusyEvent(): Promise<string> {
  const start = new Date(Date.now() + 36 * 3600_000);
  start.setUTCMinutes(0, 0, 0);
  const res = await api(OWNER, "POST", "/jmap", {
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:calendars"],
    methodCalls: [
      [
        "CalendarEvent/set",
        {
          accountId: OWNER,
          create: {
            e: {
              calendarIds: { default: true },
              title: TITLE,
              start: start.toISOString().slice(0, 19),
              timeZone: null,
              duration: "PT1H",
              freeBusyStatus: "busy",
            },
          },
        },
        "c",
      ],
    ],
  });
  const created = (
    res.json as { methodResponses: [string, { created?: { e?: { id: string } } }][] }
  ).methodResponses[0]?.[1].created?.e?.id;
  if (!created) throw new Error("could not create the busy event");
  return created;
}

test.describe("Public availability link", () => {
  let eventId = "";

  test.beforeAll(async () => {
    await api(OWNER, "DELETE", LINK);
    eventId = await createBusyEvent();
  });

  test.afterAll(async () => {
    await api(OWNER, "DELETE", LINK);
    if (eventId) {
      await api(OWNER, "POST", "/jmap", {
        using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:calendars"],
        methodCalls: [["CalendarEvent/set", { accountId: OWNER, destroy: [eventId] }, "d"]],
      });
    }
  });

  test("on, read by a stranger, made new, off", async ({ browser }) => {
    const context = await openUser(browser, OWNER);
    const page = (await context.newPage()) as Tab;
    await page.goto("/settings/calendar");
    const toggle = page.getByRole("switch", { name: "Public link" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    expect((await api(OWNER, "GET", LINK)).json).toEqual({ enabled: false });

    // Turn on: the address shows and works for a stranger.
    await toggle.click();
    const address = page.getByRole("textbox", { name: "Public link address" });
    await expect(address).toBeVisible();
    const first = await address.inputValue();
    expect(first).toMatch(/\/calendars\/availability\/feeds\/[a-z0-9]{48}$/);
    const feed = await stranger(first);
    expect(feed.status).toBe(200);
    expect(feed.body).toContain("BEGIN:VCALENDAR");
    expect(feed.body).toContain("SUMMARY:Busy");
    expect(feed.body).not.toContain(TITLE);
    for (const leak of ["LOCATION", "DESCRIPTION", "ATTENDEE", "ORGANIZER"]) {
      expect(feed.body).not.toContain(leak);
    }

    // A reload shows the same link: it is the server's, not the page's.
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Public link address" })).toHaveValue(first);

    // A new link: confirm, then the old address shows nothing.
    await page.getByRole("button", { name: "Regenerate URL" }).click();
    await page.getByRole("button", { name: "Regenerate URL" }).last().click();
    await expect(address).not.toHaveValue(first);
    const second = await address.inputValue();
    expect((await stranger(first)).status).toBe(404);
    expect((await stranger(second)).status).toBe(200);

    // Off: confirm, then neither address works and the API says off.
    await toggle.click();
    await page.getByRole("button", { name: "Turn off", exact: true }).click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    expect((await stranger(second)).status).toBe(404);
    expect((await api(OWNER, "GET", LINK)).json as PublicLink).toEqual({ enabled: false });

    await context.close();
  });
});

import { expect, type Page } from "@playwright/test";
import { E2E_PASSWORD, E2E_USERNAME } from "./notes-live";

export { E2E_PASSWORD, E2E_USERNAME };

/** Far-future Wednesday so the week is empty of install-seed events. */
export const CALENDAR_WEEK_DATE = "2033-01-12";

export type EventCardHitDump = {
  title: string;
  counts: {
    inert: number;
    createPreview: number;
    withEventId: number;
    total: number;
  };
  cards: Array<{
    summary: string;
    inert: boolean;
    createPreview: boolean;
    eventId: string | null;
    pointerEvents: string;
    hostPointerEvents: string;
    zIndex: string;
    parentClass: string;
    parentZIndex: string;
    parentPointerEvents: string;
  }>;
  topmostAtSlot: {
    localName: string;
    className: string;
    inert: boolean;
    createPreview: boolean;
    eventId: string | null;
    pointerEvents: string;
    zIndex: string;
    path: string[];
  } | null;
};

export async function openCalendarWeek(page: Page, date = CALENDAR_WEEK_DATE): Promise<void> {
  await page.goto(`/calendar/week/${date}`);
  if (
    await page
      .getByRole("button", { name: "Sign in" })
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByLabel("Username").fill(E2E_USERNAME);
    await page.locator("#password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page.locator(".calendar-workspace")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".calendar-main")).toHaveAttribute("data-view", "week", {
    timeout: 20_000,
  });
  await expect(page.locator("time-line.timeline-timed")).toBeVisible({ timeout: 20_000 });
  // Placeholder chrome mounts before hybrid bootstrap; going offline mid-fetch
  // replaces the workspace with LiveBootstrapErrorPanel ("Failed to fetch").
  await expect(page.locator(".calendar-sidebar-row").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "New event" })).toBeVisible();
  await expect(page.getByText("Failed to fetch")).toHaveCount(0);
  await expect.poll(() => calendarCacheReady(page), { timeout: 15_000 }).toBe(true);
}

export async function calendarCacheReady(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const username = localStorage.getItem("wgw.offline.calendars.username");
    if (!username) return false;
    const dbName = `wgw-offline-${username.trim().toLowerCase()}`;
    return new Promise<boolean>((resolve) => {
      const request = indexedDB.open(dbName);
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("calendars_calendars")) {
          resolve(false);
          return;
        }
        const tx = db.transaction("calendars_calendars", "readonly");
        const count = tx.objectStore("calendars_calendars").count();
        count.onsuccess = () => resolve(count.result > 0);
        count.onerror = () => resolve(false);
      };
    });
  });
}

export async function expectCalendarOffline(page: Page): Promise<void> {
  await expect(page.getByText(/Offline — changes sync when reconnected/i)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(".calendar-workspace")).toBeVisible();
  await expect(page.getByText("Failed to fetch")).toHaveCount(0);
}

export async function expectCalendarOnline(page: Page): Promise<void> {
  await expect(page.getByText(/Offline — changes sync when reconnected/i)).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(page.locator(".calendar-workspace")).toBeVisible();
  await expect(page.getByText("Failed to fetch")).toHaveCount(0);
}

export async function countEventCardsByTitle(page: Page, title: string): Promise<number> {
  return page.locator("event-card").filter({ hasText: title }).count();
}

/** Sample the card's height after pointerup so a snap-back to the pre-resize duration is visible. */
export async function sampleEventCardHeights(
  page: Page,
  title: string,
  samples = 12,
  intervalMs = 32,
): Promise<number[]> {
  const heights: number[] = [];
  const card = page.locator("event-card").filter({ hasText: title }).first();
  for (let i = 0; i < samples; i += 1) {
    const box = await card.boundingBox();
    if (box) heights.push(box.height);
    await page.waitForTimeout(intervalMs);
  }
  return heights;
}

export async function resizeEventCardEnd(page: Page, title: string, deltaY = 90): Promise<void> {
  const card = await eventCardByTitle(page, title);
  await card.scrollIntoViewIfNeeded();
  const heightBefore = (await card.boundingBox())?.height ?? 0;
  const event = page
    .locator("time-line.timeline-timed .event")
    .filter({ has: page.locator("event-card").filter({ hasText: title }) });
  await expect(event).toBeVisible({ timeout: 10_000 });
  await event.scrollIntoViewIfNeeded();
  await event.hover();
  const handle = event.locator("resize-handle[position='end']");
  await expect(handle).toBeAttached({ timeout: 10_000 });
  const box = await handle.boundingBox();
  expect(box, "end resize handle has no box").toBeTruthy();
  const x = box!.x + Math.max(box!.width / 2, 4);
  const y = box!.y + Math.max(box!.height / 2, 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + deltaY, { steps: 12 });
  const dragged = await card.boundingBox();
  expect(
    dragged ? dragged.height - heightBefore : 0,
    "resize drag did not grow the card",
  ).toBeGreaterThan(20);
  await page.mouse.up();
}

/** Sample the card's Y after pointerup so a snap-back to the pre-drag slot is visible. */
export async function sampleEventCardYs(
  page: Page,
  title: string,
  samples = 12,
  intervalMs = 32,
): Promise<number[]> {
  const ys: number[] = [];
  const card = page.locator("event-card").filter({ hasText: title }).first();
  for (let i = 0; i < samples; i += 1) {
    const box = await card.boundingBox();
    if (box) ys.push(box.y);
    await page.waitForTimeout(intervalMs);
  }
  return ys;
}

export async function deleteOpenEvent(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog");
  const edit = dialog.getByRole("button", { name: "Edit" });
  if (await edit.isVisible().catch(() => false)) {
    await edit.click();
  }
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

export async function scrollTimedGridToHour(page: Page, hour: number): Promise<void> {
  await page.evaluate((startHour) => {
    const walk = (root: Document | ShadowRoot): HTMLElement | null => {
      const hit = root.querySelector(".timeline-layout--composed");
      if (hit instanceof HTMLElement) return hit;
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          const nested = walk(el.shadowRoot);
          if (nested) return nested;
        }
      }
      return null;
    };
    const layout = walk(document);
    if (!layout) return;
    const hourHeight =
      Number.parseFloat(getComputedStyle(layout).getPropertyValue("--_lc-timeline-hour-height")) ||
      72;
    layout.scrollTop = hourHeight * startHour;
  }, hour);
}

/** Drag-create a ~1h slot on the mid-week timed column (visible clip, not off-screen 24h box). */
export async function dragCreateOnWeekGrid(page: Page, startHour = 10): Promise<void> {
  await scrollTimedGridToHour(page, startHour);
  const cell = page.locator("time-line.timeline-timed .cell-main").nth(2);
  await expect(cell).toBeVisible({ timeout: 10_000 });
  const clip = await cell.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const top = Math.max(rect.top, 80);
    const bottom = Math.min(rect.bottom, window.innerHeight - 40);
    return {
      x: rect.left + rect.width / 2,
      y: top + 24,
      yEnd: Math.min(top + 96, bottom - 8),
    };
  });
  await page.mouse.move(clip.x, clip.y);
  await page.mouse.down();
  await page.mouse.move(clip.x, clip.yEnd, { steps: 8 });
  await page.mouse.up();
}

export async function createOfflineWeekEvent(
  page: Page,
  title: string,
  startHour = 10,
): Promise<void> {
  await dragCreateOnWeekGrid(page, startHour);
  const dialog = page.getByRole("dialog", { name: "New event" });
  if (!(await dialog.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "New event" }).click();
  }
  await saveNewEventDialog(page, title);
  await expect(page.getByText("Event created").first()).toBeVisible({ timeout: 10_000 });
}

export async function saveNewEventDialog(page: Page, title: string): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "New event" });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

export async function eventCardByTitle(page: Page, title: string) {
  return page.locator("event-card").filter({ hasText: title }).first();
}

export async function dumpEventCardHitTarget(page: Page, title: string): Promise<EventCardHitDump> {
  return page.evaluate((wanted) => {
    const walkShadows = (root: Document | ShadowRoot, visit: (el: Element) => void) => {
      root.querySelectorAll("*").forEach((el) => {
        visit(el);
        if (el.shadowRoot) walkShadows(el.shadowRoot, visit);
      });
    };

    const hosts: HTMLElement[] = [];
    walkShadows(document, (el) => {
      if (el.localName === "event-card") hosts.push(el as HTMLElement);
    });

    const cardSummary = (host: HTMLElement) =>
      (host.shadowRoot?.textContent ?? host.textContent ?? "").replace(/\s+/g, " ").trim();

    const cards: EventCardHitDump["cards"] = hosts.map((host) => {
      const cs = getComputedStyle(host);
      const shell = host.shadowRoot?.querySelector(".event-card-shell") as HTMLElement | null;
      const parent = host.parentElement;
      return {
        summary: cardSummary(host),
        inert: host.hasAttribute("inert"),
        createPreview: host.hasAttribute("data-create-preview"),
        eventId: host.getAttribute("data-event-id"),
        pointerEvents: shell ? getComputedStyle(shell).pointerEvents : cs.pointerEvents,
        hostPointerEvents: cs.pointerEvents,
        zIndex: cs.zIndex,
        parentClass: parent?.className ?? "",
        parentZIndex: parent ? getComputedStyle(parent).zIndex : "",
        parentPointerEvents: parent ? getComputedStyle(parent).pointerEvents : "",
      };
    });

    let topmost: EventCardHitDump["topmostAtSlot"] = null;
    const target = hosts.find((el) => cardSummary(el).includes(wanted));
    if (target) {
      const rect = target.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + Math.min(12, rect.height / 2);
      const stack = document.elementsFromPoint(x, y);
      const hit = stack[0] as HTMLElement | undefined;
      if (hit) {
        const host = hit.closest("event-card") ?? (hit.localName === "event-card" ? hit : null);
        const cs = getComputedStyle(hit);
        topmost = {
          localName: hit.localName,
          className: typeof hit.className === "string" ? hit.className : "",
          inert: Boolean(host?.hasAttribute("inert") || hit.hasAttribute("inert")),
          createPreview: Boolean(
            host?.hasAttribute("data-create-preview") || hit.hasAttribute("data-create-preview"),
          ),
          eventId: host?.getAttribute("data-event-id") ?? hit.getAttribute("data-event-id"),
          pointerEvents: cs.pointerEvents,
          zIndex: cs.zIndex,
          path: stack.slice(0, 8).map((n) => {
            const e = n as HTMLElement;
            const id = e.getAttribute?.("data-event-id");
            const flags = [
              e.localName,
              e.classList?.[0],
              e.hasAttribute?.("inert") ? "inert" : "",
              e.hasAttribute?.("data-create-preview") ? "preview" : "",
              id ? `id=${id}` : "",
            ]
              .filter(Boolean)
              .join(".");
            return flags;
          }),
        };
      }
    }

    return {
      title: wanted,
      counts: {
        inert: cards.filter((c) => c.inert).length,
        createPreview: cards.filter((c) => c.createPreview).length,
        withEventId: cards.filter((c) => Boolean(c.eventId)).length,
        total: cards.length,
      },
      cards,
      topmostAtSlot: topmost,
    };
  }, title);
}

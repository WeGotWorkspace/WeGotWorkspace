import { E2E_PASSWORD } from "./helpers/calendar-live";
import { expect, test, type BrowserContext } from "./helpers/live-test";
import {
  cachedAudience,
  dropMesh,
  meshOpen,
  pushConnected,
  recordPushRequests,
  spyOnMesh,
  writerCreatesTask,
} from "./helpers/mesh-spy";
import {
  cleanUpCase,
  createList,
  openTasksTab,
  openUser,
  OWNER,
  shareList,
  showAllTasks,
  sleep,
  TEAMMATE,
} from "./helpers/tasks-matrix";

/**
 * #1943: the push hub reconnects every 5 s while this browser's presence mesh
 * has held a link to another user for 30 s, and every 3 s (the server's
 * `retry`) without one.
 *
 * Two users in two browsers; the teammate watches a list the owner shares.
 * Each round the owner adds one task from their open tab (in-suite: the mesh
 * nudges the teammate at once) and one over CalDAV, the way a phone or desktop
 * client writes (only the teammate's regular reconnect brings it in).
 *
 * The teammate's event-source requests show the cadence: 3 s, 5 s once the
 * link has held, and 3 s again right after the mesh drops.
 */

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
/** In-suite change with the mesh up. */
const MESH_BOUND_MS = 1_500;
/** One event-source request, the `/changes` sync and the paint. */
const SYNC_MS = 1_500;
const ROUNDS = 3;
/** Gap between two regular request starts: the interval plus up to this much. */
const GAP_SLACK_MS = 800;

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });
test.describe.configure({ timeout: 360_000 });

for (const mesh of ["up", "blocked"] as const) {
  test(`push reconnects every ${mesh === "up" ? 5 : 3} s with the mesh ${mesh}`, async ({
    browser,
  }) => {
    const id = `pmi${mesh}${Date.now().toString(36)}`;
    const events: string[] = [];
    const contexts: BrowserContext[] = [];
    const intervalMs = mesh === "up" ? 5_000 : 3_000;

    try {
      const listId = await createList(`L ${id}`);
      await shareList(listId, TEAMMATE, "write");

      const writerContext = await openUser(browser, OWNER);
      const observerContext = await openUser(browser, TEAMMATE);
      contexts.push(writerContext, observerContext);
      for (const context of contexts) await context.addInitScript(spyOnMesh);
      const blockSignaling = () =>
        // Every presence room (one per Team, #1921).
        observerContext.route("**/api/v1/rooms/p_*/**", (route) => route.abort());
      if (mesh === "blocked") await blockSignaling();
      const requests = recordPushRequests(observerContext);

      const connected = pushConnected(observerContext);
      const writer = await openTasksTab(writerContext, "writer", events, OWNER);
      const observer = await openTasksTab(observerContext, "observer", events, TEAMMATE);
      await showAllTasks(observer);
      await connected;
      await expect
        .poll(() => cachedAudience(writer, listId), { timeout: 30_000 })
        .toContain(TEAMMATE);

      if (mesh === "up") {
        await expect.poll(() => meshOpen(observer), { timeout: 60_000 }).toBeGreaterThan(0);
        // The link must hold 30 s before the interval grows.
        await expect
          .poll(() => lastGaps(requests, 2).filter((gap) => near(gap, 5_000)).length, {
            timeout: 60_000,
            intervals: [1_000],
          })
          .toBe(2);
      } else {
        // Long enough that a held link would have switched to 5 s.
        await sleep(40_000);
      }
      const idleFrom = requests.length;
      await sleep(16_000);
      const idleGaps = gaps(requests.slice(idleFrom - 1));
      expect(idleGaps.length).toBeGreaterThanOrEqual(2);
      expectGaps(idleGaps, intervalMs);

      const inSuiteMs: number[] = [];
      const davMs: number[] = [];
      for (let round = 0; round < ROUNDS; round += 1) {
        // A random phase against the interval, and past the writer's check-now throttle.
        await sleep(2_500 + Math.round(Math.random() * 3_000));
        const title = `app ${round} ${id}`;
        let sentAt = Date.now();
        await writerCreatesTask(writer, listId, title);
        await expect(observer.locator(".tasks-main-view__title", { hasText: title })).toBeVisible({
          timeout: mesh === "up" ? MESH_BOUND_MS : intervalMs + SYNC_MS,
        });
        inSuiteMs.push(Date.now() - sentAt);

        await sleep(2_500 + Math.round(Math.random() * 3_000));
        const davTitle = `dav ${round} ${id}`;
        sentAt = Date.now();
        await putTodo(listId, `${id}-${round}`, davTitle);
        await expect(
          observer.locator(".tasks-main-view__title", { hasText: davTitle }),
        ).toBeVisible({ timeout: intervalMs + SYNC_MS });
        davMs.push(Date.now() - sentAt);
      }

      let dropGaps: number[] = [];
      if (mesh === "up") {
        // The link breaks on the writer's side, as when a peer's network drops; the
        // observer cannot dial again, because its signaling is blocked.
        await blockSignaling();
        const lostAt = requests.length;
        expect(await dropMesh(writer)).toBeGreaterThan(0);
        // Three gaps after the drop; at 5 s they would take 15 s or more.
        await expect
          .poll(() => gaps(requests.slice(lostAt)).length, { timeout: 20_000, intervals: [500] })
          .toBeGreaterThanOrEqual(3);
        // The first gap may straddle the drop; the ones after it run at 3 s.
        dropGaps = gaps(requests.slice(lostAt)).slice(0, 3);
        console.log(`[push-mesh-interval] after the drop: ${gaps(requests).join(" ")}`);
        expectGaps(dropGaps, 3_000);
      }

      const summary =
        `mesh ${mesh}: in-suite ${inSuiteMs.join("/")} ms, CalDAV ${davMs.join("/")} ms; ` +
        `idle gaps ${idleGaps.join("/")} ms` +
        (mesh === "up" ? `; after the drop ${dropGaps.join("/")} ms` : "") +
        `; all gaps ${gaps(requests).join(" ")}`;
      test.info().annotations.push({ type: "cadence", description: summary });
      console.log(`[push-mesh-interval] ${summary}`);
      expect(events.filter((line) => line.includes("page error"))).toEqual([]);
    } finally {
      for (const context of contexts) await context.close().catch(() => undefined);
      await cleanUpCase(id).catch(() => undefined);
    }
  });
}

/** A gap between two regular request starts: the interval, plus the request itself. */
function near(gap: number, intervalMs: number): boolean {
  return gap >= intervalMs - 200 && gap <= intervalMs + GAP_SLACK_MS;
}

function expectGaps(found: number[], intervalMs: number): void {
  expect(
    found.filter((gap) => !near(gap, intervalMs)),
    `gaps of about ${intervalMs} ms`,
  ).toEqual([]);
}

function gaps(starts: number[]): number[] {
  return starts.slice(1).map((start, index) => start - starts[index]!);
}

function lastGaps(starts: number[], count: number): number[] {
  return gaps(starts).slice(-count);
}

/** Create one VTODO in the owner's list over CalDAV, as a phone or desktop client does. */
async function putTodo(listId: string, uid: string, title: string): Promise<void> {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WGW e2e//push-mesh-interval//EN",
    "BEGIN:VTODO",
    `UID:${uid}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `SUMMARY:${title}`,
    "STATUS:NEEDS-ACTION",
    "END:VTODO",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const res = await fetch(`${API}/calendars/${OWNER}/${listId}/${uid}.ics`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${Buffer.from(`${OWNER}:${E2E_PASSWORD}`).toString("base64")}`,
      "Content-Type": "text/calendar; charset=utf-8",
    },
    body: ics,
  });
  expect(res.status, `PUT ${uid}.ics: ${await res.text()}`).toBeLessThan(300);
}

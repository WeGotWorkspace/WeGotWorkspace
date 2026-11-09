import { expect, test, type BrowserContext, type Page } from "./helpers/live-test";
import { api, openUser, OWNER, passwordFor, setTabOffline, TEAMMATE } from "./helpers/live-matrix";
import type { Tab } from "./helpers/live-matrix";
import { meshOpen, spyOnMesh } from "./helpers/mesh-spy";

/**
 * Presence is one room per own Team (#1921).
 *
 * User A shares a Team with the teammate, user B is alone in another Team. The
 * mesh between A and the teammate comes up (control), and A and B never see each
 * other's presence nor open a room of the other's Team. When the owner then adds
 * both to a new Team, they open a data channel without a reload (the DM list itself
 * only lists the new Team mate after a reload, #1918); when B is removed again, B's
 * dot goes away on A.
 */

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test("users in different Teams do not see each other's presence", async ({ browser }) => {
  test.setTimeout(240_000);
  const run = Date.now().toString(36);
  const userA = `e2e-pa-${run}`;
  const userB = `e2e-pb-${run}`;
  const nameA = `PresA ${run}`;
  const nameB = `PresB ${run}`;
  const teamA = `e2e-pta-${run}`;
  const teamB = `e2e-ptb-${run}`;
  const teamShared = `e2e-pts-${run}`;

  for (const [username, displayName] of [
    [userA, nameA],
    [userB, nameB],
  ]) {
    await ensureOk(
      await api(OWNER, "POST", "/admin/users", {
        username,
        password: passwordFor(username),
        displayName,
        email: `${username}@example.test`,
      }),
    );
  }
  for (const [slug, members] of [
    [teamA, [userA, TEAMMATE]],
    [teamB, [userB]],
  ] as const) {
    await ensureOk(await api(OWNER, "POST", "/admin/groups", { slug, displayName: slug }));
    for (const member of members) {
      await ensureOk(await api(OWNER, "PUT", `/admin/groups/${slug}/members/${member}`));
    }
  }

  const contexts: BrowserContext[] = [];
  const open = async (user: string, spy: boolean): Promise<Tab> => {
    const context = await openUser(browser, user);
    contexts.push(context);
    if (spy) await context.addInitScript(spyOnMesh);
    const page = (await context.newPage()) as Tab;
    await page.goto("/meet");
    return page;
  };

  try {
    const tabA = await open(userA, true);
    const tabB = await open(userB, true);
    const tabMate = await open(TEAMMATE, false);

    const refused = { a: [] as string[], b: [] as string[] };
    const watch = (page: Page, foreign: string, into: string[]) => {
      page.on("response", (response) => {
        const url = decodeURIComponent(response.url());
        if (url.includes(`/rooms/p_groups.${foreign}/`) && response.status() < 300) {
          into.push(`${response.status()} ${url}`);
        }
      });
    };
    watch(tabA, teamB, refused.a);
    watch(tabB, teamA, refused.b);

    const dotOn = (page: Page, displayName: string) =>
      page
        .locator(".meet-direct-message-row")
        .filter({ hasText: displayName })
        .locator('[data-presence="online"]');

    // Control: the mesh of A's Team is up before anything is judged absent.
    await expect(dotOn(tabA, "Member")).toBeVisible({ timeout: 60_000 });
    await expect(dotOn(tabMate, nameA)).toBeVisible({ timeout: 60_000 });

    await tabA.waitForTimeout(15_000);
    await expect(dotOn(tabA, nameB)).toHaveCount(0);
    await expect(dotOn(tabB, nameA)).toHaveCount(0);
    expect(await meshOpen(tabB), "B shares no room with anyone").toBe(0);
    expect(refused.a, "A joined a room of B's Team").toEqual([]);
    expect(refused.b, "B joined a room of A's Team").toEqual([]);

    // A new shared Team is followed without a reload.
    await ensureOk(
      await api(OWNER, "POST", "/admin/groups", { slug: teamShared, displayName: teamShared }),
    );
    for (const member of [userA, userB]) {
      await ensureOk(await api(OWNER, "PUT", `/admin/groups/${teamShared}/members/${member}`));
    }
    await recheck(tabA);
    await recheck(tabB);
    // B shared no room before; a data channel now proves both followed the new Team.
    await expect.poll(() => meshOpen(tabB), { timeout: 90_000 }).toBeGreaterThan(0);
    // The DM list shows Team mates only (#1918). A load paints the cached list and
    // refreshes the cache behind it, so B's row shows on the load after that refresh.
    await reloadTwice(tabA);
    await reloadTwice(tabB);
    await expect(dotOn(tabA, nameB)).toBeVisible({ timeout: 90_000 });
    await expect(dotOn(tabB, nameA)).toBeVisible({ timeout: 90_000 });

    // B leaves it again: B's row stays until the list is read again, but its dot goes away.
    await ensureOk(await api(OWNER, "DELETE", `/admin/groups/${teamShared}/members/${userB}`));
    await recheck(tabA);
    await recheck(tabB);
    await expect(dotOn(tabA, nameB)).toHaveCount(0, { timeout: 90_000 });
  } finally {
    for (const context of contexts) await context.close();
  }
});

/** Reloads, waits for the fresh people list to reach the cache, then reloads again. */
async function reloadTwice(tab: Tab): Promise<void> {
  const refreshed = tab.waitForResponse(
    (response) => response.url().includes("/calendars/scheduling/invitees") && response.ok(),
  );
  await tab.reload();
  await refreshed;
  await tab.waitForTimeout(1_000);
  await tab.reload();
}

/** Offline and back fires the `online` re-check of the Team list; it waits out the 10 s gap. */
async function recheck(tab: Tab): Promise<void> {
  await tab.waitForTimeout(10_500);
  await setTabOffline(tab, true);
  await setTabOffline(tab, false);
}

/** 200/201, or 400 "already …" for an account a previous run created. */
async function ensureOk(res: { status: number; json: unknown }): Promise<void> {
  if (res.status >= 200 && res.status < 300) return;
  const error = (res.json as { error?: string } | null)?.error ?? "";
  if (res.status === 400 && /already/i.test(error)) return;
  throw new Error(`Setup ${res.status}: ${JSON.stringify(res.json)}`);
}

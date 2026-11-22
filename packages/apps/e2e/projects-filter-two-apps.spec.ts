// One Project switch across two apps (#818, chunk C3 of the Projects on Teams plan).
//
// A team admin creates a Project over REST (creating happens in Settings). The
// spec picks it in the sidebar's Project filter; Calendar then lists only its
// calendar and Tasks only its task list. The choice survives a reload and shows in a second
// tab; "All Teams" brings the other collections back. Everything the spec
// creates is removed again (archive, then purge, over REST; the purge is the organization admin's Admin route).
import { openCalendarWeek } from "./helpers/calendar-live";
import { expect, test, type Page } from "./helpers/live-test";
import { api, OWNER } from "./helpers/live-matrix";

const TEAM = "team";
const FILTER_KEY = "wgw.ui.projectFilter";

type ProjectRow = { id: string; name: string };
type MemberRow = { username: string; isTeamAdmin: boolean };

/** The collection names a sidebar section lists, without its "All" row. */
async function sectionNames(page: Page, heading: string): Promise<string[]> {
  const section = page
    .locator("section.sidebar-section")
    .filter({ has: page.getByRole("heading", { name: heading }) });
  const names = await section.locator(".collection-sidebar-row__name").allTextContents();
  return names.filter((name) => name !== "All");
}

async function expectSection(page: Page, heading: string, expected: string[]): Promise<void> {
  await expect.poll(() => sectionNames(page, heading), { timeout: 20_000 }).toEqual(expected);
}

async function expectSectionBeyond(page: Page, heading: string, own: string): Promise<void> {
  await expect
    .poll(async () => (await sectionNames(page, heading)).length, { timeout: 20_000 })
    .toBeGreaterThan(1);
  expect(await sectionNames(page, heading)).toContain(own);
}

const filterTrigger = (page: Page) => page.getByRole("combobox", { name: "Project" });

async function storedFilter(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), FILTER_KEY);
}

async function pickFilter(page: Page, option: string): Promise<void> {
  await filterTrigger(page).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function openTasks(page: Page): Promise<void> {
  await page.goto("/tasks");
  await expect(page.getByRole("button", { name: "New task" })).toBeVisible({ timeout: 30_000 });
}

test.describe("Project filter across two apps", () => {
  const name = `E2E Project ${Date.now()}`;
  let appointedAdmin = false;

  test.beforeAll(async () => {
    // The dev install's Team has no team admin; creating a Project is a team admin's role.
    const members = await api(OWNER, "GET", `/teams/${TEAM}/members`);
    expect(members.status, "GET team members").toBe(200);
    const me = (members.json as { list: MemberRow[] }).list.find((m) => m.username === OWNER);
    expect(me, `${OWNER} is a member of the Team`).toBeTruthy();
    if (!me!.isTeamAdmin) {
      const res = await api(OWNER, "PUT", `/teams/${TEAM}/admins/${OWNER}`);
      expect(res.status, "appoint team admin").toBe(200);
      appointedAdmin = true;
    }
  });

  test.afterAll(async () => {
    const list = await api(OWNER, "GET", "/projects");
    const mine = (list.json as { list: ProjectRow[] }).list.filter((p) => p.name === name);
    for (const project of mine) {
      await api(OWNER, "POST", `/projects/${project.id}/archive`);
      const purged = await api(OWNER, "DELETE", `/admin/projects/${project.id}`);
      expect(purged.status, "purge the spec's Project").toBeLessThan(300);
    }
    if (appointedAdmin) await api(OWNER, "DELETE", `/teams/${TEAM}/admins/${OWNER}`);
  });

  test("create, switch Calendar to Tasks, reload, second tab, All Projects", async ({
    page,
    context,
  }) => {
    await openCalendarWeek(page);
    await expect(filterTrigger(page)).toBeVisible();
    await expect(filterTrigger(page)).toContainText("All Teams");

    // Create the Project over REST, then pick it in the filter menu.
    const created = await api(OWNER, "POST", "/projects", { teamSlug: TEAM, name });
    expect(created.status, "POST /projects").toBeLessThan(300);
    await page.reload();
    await expect(filterTrigger(page)).toBeVisible({ timeout: 30_000 });
    await pickFilter(page, name);
    await expect(filterTrigger(page)).toContainText(name);
    expect(await storedFilter(page)).toMatch(/^p:/);

    // Calendar: only the Project's calendar. Tasks: only its task list.
    await expectSection(page, "My calendars", [name]);
    await openTasks(page);
    await expect(filterTrigger(page)).toContainText(name);
    await expectSection(page, "My lists", [name]);

    // A reload keeps the choice.
    const stored = await storedFilter(page);
    await page.reload();
    await expect(page.getByRole("button", { name: "New task" })).toBeVisible({ timeout: 30_000 });
    await expect(filterTrigger(page)).toContainText(name);
    expect(await storedFilter(page)).toBe(stored);
    await expectSection(page, "My lists", [name]);

    // A second tab opens on the same choice, in another app.
    const second = await context.newPage();
    await openCalendarWeek(second);
    await expect(filterTrigger(second)).toContainText(name);
    await expectSection(second, "My calendars", [name]);
    await second.close();

    // "All Teams" brings the other collections back.
    await pickFilter(page, "All Teams");
    await expect(filterTrigger(page)).toContainText("All Teams");
    expect([null, "all"]).toContain(await storedFilter(page));
    await expectSectionBeyond(page, "My lists", name);
    await openCalendarWeek(page);
    await expectSectionBeyond(page, "My calendars", name);
  });
});

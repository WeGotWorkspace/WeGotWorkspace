import { expect, test, type BrowserContext } from "./helpers/live-test";
import {
  cleanUpCase,
  createList,
  createTask,
  ensureTasksTeam,
  openTasksTab,
  openUser,
  OWNER,
  patchTask,
  serverTask,
  shareList,
  showAllTasks,
  TEAMMATE,
  api,
  type Tab,
} from "./helpers/tasks-matrix";

/**
 * #2208: two people type a task's title and notes together (live app and API,
 * each in a fresh browser). The text reaches the other side over the room,
 * the room saves it, the list row follows, and an outside REST edit arrives
 * in both open tabs without a question.
 */

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

const LIVE_MS = 15_000;

async function openTask(tab: Tab, name: string): Promise<void> {
  await showAllTasks(tab);
  await tab.getByText(name, { exact: true }).first().click();
  // The fields wait for the room's first content, as a note's body does.
  await expect(tab.getByLabel("Notes", { exact: true })).toBeEditable({ timeout: LIVE_MS });
  await expect(title(tab)).toBeEditable();
}

function notes(tab: Tab) {
  return tab.getByLabel("Notes", { exact: true });
}

function title(tab: Tab) {
  return tab.locator(".note-detail-view__title").first();
}

test("two people type a task's title and notes together", async ({ browser }) => {
  const id = `live${Date.now().toString(36)}`;
  await ensureTasksTeam();
  const events: string[] = [];
  const contexts: BrowserContext[] = [];

  try {
    const listId = await createList(`L ${id}`);
    await shareList(listId, TEAMMATE, "write");
    const task = await createTask(listId, `Buy milk ${id}`);

    const ownerContext = await openUser(browser, OWNER);
    const mateContext = await openUser(browser, TEAMMATE);
    contexts.push(ownerContext, mateContext);
    const owner = await openTasksTab(ownerContext, "owner", events);
    const mate = await openTasksTab(mateContext, "mate", events, TEAMMATE);
    for (const tab of [owner, mate]) {
      tab.on("response", (response) => {
        if (!response.url().includes("/text")) return;
        const method = response.request().method();
        const header = response.request().headers()["x-wgw-external-write"] ?? "-";
        events.push(
          `TRACE ${tab.tag} ${method} ${response.status()} ext=${header} t=${Date.now() % 100000}`,
        );
      });
    }
    await openTask(owner, task.title);
    await openTask(mate, task.title);

    // The detail header shows who else has the task open, as a note's does.
    for (const tab of [owner, mate]) {
      await expect(
        tab.locator(".docs-collab-presence-chrome--header [data-presence='online']"),
      ).toHaveCount(1, { timeout: LIVE_MS });
    }
    await owner.screenshot({ path: test.info().outputPath("owner-presence.png") });
    await mate.screenshot({ path: test.info().outputPath("mate-presence.png") });

    // Typing on one side shows on the other, before any save.
    await notes(owner).click();
    await notes(owner).pressSequentially("Two cartons");
    await expect(notes(mate)).toHaveValue("Two cartons", { timeout: LIVE_MS });

    await title(mate).click();
    await title(mate).press("End");
    await title(mate).pressSequentially(" now");
    await expect(title(owner)).toHaveValue(`Buy milk ${id} now`, { timeout: LIVE_MS });
    // The list row shows the title as it is typed.
    await expect(owner.getByText(`Buy milk ${id} now`, { exact: true }).first()).toBeVisible();

    // The room saves both fields.
    await expect
      .poll(
        async () => {
          const saved = await serverTask(task.id);
          return `${saved?.title} | ${saved?.description ?? ""}`;
        },
        { timeout: LIVE_MS },
      )
      .toBe(`Buy milk ${id} now | Two cartons`);

    await owner.screenshot({ path: test.info().outputPath("owner-typed.png") });
    await mate.screenshot({ path: test.info().outputPath("mate-typed.png") });

    // An outside edit (REST, like a native client) reaches both open tabs
    // quietly: nobody has unsaved typing, so nobody is asked.
    const outside = await patchTask(task.id, { description: "From REST" });
    expect(outside.status).toBe(200);
    await expect(notes(owner)).toHaveValue("From REST", { timeout: LIVE_MS });
    await expect(notes(mate)).toHaveValue("From REST", { timeout: LIVE_MS });
    for (const tab of [owner, mate]) {
      const dialogs = await tab.getByRole("dialog").allInnerTexts();
      console.log(tab.tag, "dialogs:", JSON.stringify(dialogs));
    }
    await expect(owner.getByRole("dialog")).toHaveCount(0);
    await expect(mate.getByRole("dialog")).toHaveCount(0);

    // Typing goes on on top of it and saves.
    await notes(mate).click();
    await notes(mate).press("End");
    await notes(mate).pressSequentially("!");
    await expect(notes(owner)).toHaveValue("From REST!", { timeout: LIVE_MS });
    await expect
      .poll(async () => (await serverTask(task.id))?.description ?? "", { timeout: LIVE_MS })
      .toBe("From REST!");

    // A blank title holds the save and says why.
    await title(owner).fill("   ");
    await expect(
      owner.getByRole("status").filter({ hasText: "A task needs a title" }),
    ).toBeVisible();
    await owner.screenshot({ path: test.info().outputPath("owner-blank-title.png") });
    expect((await serverTask(task.id))?.title).toBe(`Buy milk ${id} now`);
    await title(owner).fill(`Buy milk ${id} again`);
    await expect
      .poll(async () => (await serverTask(task.id))?.title, { timeout: LIVE_MS })
      .toBe(`Buy milk ${id} again`);

    // Nothing went through the task PATCH: the text has its own resource.
    const text = await api(OWNER, "GET", `/tasks/items/${encodeURIComponent(task.id)}/text`);
    expect((text.json as { description?: string }).description).toBe("From REST!");

    // Two writers' saves race: a 412 re-merges and saves again, and a retry
    // that crosses the outside edit gets 409, re-reads quietly and saves.
    // Group presence rooms are not part of this test.
    const unexpected = events.filter(
      (line) =>
        !line.startsWith("TRACE") &&
        !line.includes("412") &&
        !line.includes("409") &&
        !line.includes("/rooms/p_") &&
        !line.includes("status of 400"),
    );
    expect(unexpected).toEqual([]);
  } finally {
    console.log("EVENTS\n" + events.map((line) => line.slice(0, 300)).join("\n"));
    for (const context of contexts) await context.close();
    await cleanUpCase(id);
  }
});

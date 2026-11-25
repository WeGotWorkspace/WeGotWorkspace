// A big Tasks list downloads in pages (#2361, Epic #2284): a new device asks for
// at most 500 stored tasks per request instead of the whole list in one answer,
// and still ends with every task cached and shown. The list is seeded with one
// import, so the test spends little of the API budget on setup.
import { expect, resetApiBudgetAfterSetup, test, type Request } from "./helpers/live-test";
import { api, OWNER } from "./helpers/live-matrix";
import { createList, deleteList, waitForTasks } from "./helpers/tasks-matrix";
import type { Tab } from "./helpers/live-matrix";

const RUN = Date.now().toString(36);
const LIST = `Pages ${RUN}`;
const TASK_COUNT = 1100;
const PAGE = 500;

function importIcs(): string {
  const todos = Array.from({ length: TASK_COUNT }, (_, i) => {
    const n = String(i + 1).padStart(4, "0");
    const notes = i % 3 === 0 ? `DESCRIPTION:Notes for task ${n}\r\n` : "";
    return `BEGIN:VTODO\r\nUID:pages-${RUN}-${n}\r\nSUMMARY:${LIST} ${n}\r\n${notes}END:VTODO\r\n`;
  });
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//e2e//EN\r\n${todos.join("")}END:VCALENDAR\r\n`;
}

test.describe("Tasks list pages", () => {
  test("a new device downloads a big list in pages and shows every task", async ({ page }) => {
    test.setTimeout(180_000);
    const listId = await createList(LIST);
    try {
      const token = (await api(OWNER, "GET", "/tasks/tasklists")).status; // warm the login
      expect(token).toBe(200);
      const res = await fetch(
        `${process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080"}/api/v1/tasks/items/import?taskListId=${encodeURIComponent(listId)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "text/calendar",
            Authorization: `Bearer ${await bearer()}`,
          },
          body: importIcs(),
        },
      );
      expect(res.status).toBe(201);
      resetApiBudgetAfterSetup();

      const itemRequests: Request[] = [];
      page.on("request", (req) => {
        const url = new URL(req.url());
        if (
          url.pathname.endsWith("/tasks/items") &&
          url.searchParams.get("taskListId") === listId &&
          req.method() === "GET"
        ) {
          itemRequests.push(req);
        }
      });

      await page.goto(`/tasks/lists/${encodeURIComponent(listId)}`);
      await waitForTasks(page as Tab);
      await expect(
        page.locator(".tasks-list-panel__list[data-workspace-list-rows]"),
      ).toHaveAttribute("data-workspace-list-rows", String(TASK_COUNT), { timeout: 60_000 });

      // 1100 tasks = pages of 500, 500 and 100: no request asked for the whole list.
      const limits = itemRequests.map((req) => new URL(req.url()).searchParams.get("limit"));
      expect(limits.length).toBeGreaterThanOrEqual(3);
      expect(new Set(limits)).toEqual(new Set([String(PAGE)]));
      const cursors = itemRequests.map((req) => new URL(req.url()).searchParams.get("cursor"));
      expect(cursors.filter((cursor) => cursor === null).length).toBeGreaterThanOrEqual(1);
      expect(cursors.filter((cursor) => cursor !== null).length).toBeGreaterThanOrEqual(2);
    } finally {
      await deleteList(listId);
    }
  });
});

async function bearer(): Promise<string> {
  const { apiToken } = await import("./helpers/live-matrix");
  return apiToken(OWNER);
}

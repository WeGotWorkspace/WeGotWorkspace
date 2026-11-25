import { beforeEach, describe, expect, it, vi } from "vitest";
import { listTasks, TASKS_LIST_PAGE_SIZE, TasksRequestError } from "@/lib/api/wgw/tasks";
import { wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";

vi.mock("@/lib/api/wgw/http", () => ({
  wgwFetch: vi.fn(),
  wgwFetchPrincipal: vi.fn(),
  wgwReadJson: vi.fn(),
}));

vi.mock("@/lib/offline/core/collection-check-now", () => ({
  cachedCollectionAudience: vi.fn(() => null),
  cachedItemAudience: vi.fn(() => null),
  checkNowAfterWrite: vi.fn(),
}));

function pages(...bodies: unknown[]) {
  vi.mocked(wgwFetch).mockImplementation(async () => new Response(null, { status: 200 }));
  for (const body of bodies) vi.mocked(wgwReadJson).mockResolvedValueOnce(body);
}

const task = (id: string) => ({ id, taskListId: "inbox" });

describe("listTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("follows the cursor until the last page and joins the pages in order", async () => {
    pages(
      { list: [task("a"), task("b")], nextCursor: "b.ics" },
      { list: [task("c")], nextCursor: "c.ics" },
      { list: [task("d")], nextCursor: null },
    );

    const tasks = await listTasks({ taskListId: "inbox" });

    expect(tasks.map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
    const paths = vi.mocked(wgwFetch).mock.calls.map((call) => call[0]);
    expect(paths).toEqual([
      `/tasks/items?taskListId=inbox&limit=${TASKS_LIST_PAGE_SIZE}`,
      `/tasks/items?taskListId=inbox&limit=${TASKS_LIST_PAGE_SIZE}&cursor=b.ics`,
      `/tasks/items?taskListId=inbox&limit=${TASKS_LIST_PAGE_SIZE}&cursor=c.ics`,
    ]);
  });

  it("stops after one request when the server answers the whole list without a cursor", async () => {
    pages({ list: [task("a"), task("b")] });

    const tasks = await listTasks({ taskListId: "inbox" });

    expect(tasks).toHaveLength(2);
    expect(wgwFetch).toHaveBeenCalledTimes(1);
  });

  it("encodes the list id and the cursor", async () => {
    pages({ list: [], nextCursor: "a b&c.ics" }, { list: [] });

    await listTasks({ taskListId: "work list" });

    const paths = vi.mocked(wgwFetch).mock.calls.map((call) => call[0]);
    expect(paths[0]).toContain("taskListId=work+list");
    expect(paths[1]).toContain("cursor=a+b%26c.ics");
  });

  it("throws instead of returning a partial list when a cursor repeats", async () => {
    pages({ list: [task("a")], nextCursor: "a.ics" }, { list: [task("b")], nextCursor: "a.ics" });

    await expect(listTasks({ taskListId: "inbox" })).rejects.toBeInstanceOf(TasksRequestError);
  });

  it("passes a failed page on, so the cache is never reconciled with half a list", async () => {
    vi.mocked(wgwFetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.mocked(wgwReadJson).mockResolvedValueOnce({ list: [task("a")], nextCursor: "a.ics" });
    vi.mocked(wgwFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "x" }), { status: 503 }),
    );

    await expect(listTasks({ taskListId: "inbox" })).rejects.toMatchObject({ status: 503 });
  });
});

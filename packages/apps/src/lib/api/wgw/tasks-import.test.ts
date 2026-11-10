import { beforeEach, describe, expect, it, vi } from "vitest";
import { importTasksLive, TasksRequestError } from "@/lib/api/wgw/tasks";
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

function respond(status: number, body: unknown) {
  vi.mocked(wgwFetch).mockResolvedValue(new Response(null, { status }));
  vi.mocked(wgwReadJson).mockResolvedValue(body);
}

describe("importTasksLive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts the ICS text to the list and returns the result", async () => {
    respond(201, { list: [{ id: "t1" }], errors: [], skipped: { events: 2 } });

    const result = await importTasksLive("BEGIN:VCALENDAR", { taskListId: "work list" });

    expect(wgwFetch).toHaveBeenCalledWith(
      "/tasks/items/import?taskListId=work%20list",
      expect.objectContaining({
        method: "POST",
        body: "BEGIN:VCALENDAR",
        headers: { "Content-Type": "text/calendar" },
      }),
    );
    expect(result).toEqual({ list: [{ id: "t1" }], errors: [], skipped: { events: 2 } });
  });

  it("returns a 400 that carries per-task errors as a result", async () => {
    const errors = [{ index: 0, message: "exists", code: "already_exists", title: "Buy milk" }];
    respond(400, { list: [], errors, skipped: { events: 0 } });

    const result = await importTasksLive("BEGIN:VCALENDAR", { taskListId: "inbox" });

    expect(result.list).toEqual([]);
    expect(result.errors).toEqual(errors);
  });

  it("defaults a missing skipped count to zero", async () => {
    respond(201, { list: [{ id: "t1" }], errors: [] });

    const result = await importTasksLive("BEGIN:VCALENDAR", { taskListId: "inbox" });

    expect(result.skipped).toEqual({ events: 0 });
  });

  it("throws a request error with the API message and code otherwise", async () => {
    respond(400, { error: "No VTODO data found.", code: "bad_request" });

    const error = await importTasksLive("BEGIN:VCALENDAR", { taskListId: "inbox" }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(TasksRequestError);
    expect(error).toMatchObject({
      message: "No VTODO data found.",
      status: 400,
      code: "bad_request",
    });
  });
});

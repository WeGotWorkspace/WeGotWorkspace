import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { createWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-routes";

describe("wegotworkspace meet routes", () => {
  it("matches /meet/meetings/:meetingId on direct loads", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/meet/meetings/room-123"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();

    const match = router.state.matches.find((entry) => entry.params.meetingId);
    expect(match?.params).toMatchObject({ meetingId: "room-123" });
    expect(router.state.location.pathname).toBe("/meet/meetings/room-123");
  });

  it("has redirect logic for /meet/guest?room=X", () => {
    const history = createMemoryHistory({ initialEntries: ["/"] });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    const route = router.routesByPath["/meet/guest"];
    expect(route?.options.beforeLoad).toEqual(expect.any(Function));
  });

  it("has redirect logic for /meet/join?room=X", () => {
    const history = createMemoryHistory({ initialEntries: ["/"] });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    const route = router.routesByPath["/meet/join"];
    expect(route?.options.beforeLoad).toEqual(expect.any(Function));
  });

  it("has redirect logic for /meet?room= query parameter", () => {
    const history = createMemoryHistory({ initialEntries: ["/"] });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    const route = router.routesByPath["/meet"];
    expect(route?.options.beforeLoad).toEqual(expect.any(Function));
  });

  it("matches /meet index without query parameters", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/meet"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();

    expect(router.state.location.pathname).toBe("/meet");
    expect(router.state.matches.some((entry) => entry.pathname === "/meet")).toBe(true);
  });
});

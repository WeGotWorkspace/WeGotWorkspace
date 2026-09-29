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

  it("/meet/guest?room=abc triggers redirect to /meet/meetings/abc", () => {
    const history = createMemoryHistory({ initialEntries: ["/"] });
    const router = createWeGotWorkspaceRouter({ mode: "live", history });
    const route = router.routesByPath["/meet/guest"];
    const beforeLoad = route?.options.beforeLoad;

    expect(beforeLoad).toBeDefined();

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      beforeLoad?.({ search: { room: "abc" }, location: { pathname: "/meet/guest" } } as any);
      throw new Error("Expected redirect to be thrown");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      expect(error).toBeDefined();
      expect(error.options.to).toBe("/meet/meetings/$meetingId");
      expect(error.options.params).toEqual({ meetingId: "abc" });
      expect(error.options.replace).toBe(true);
    }
  });

  it("/meet/join?room=abc triggers redirect to /meet/meetings/abc", () => {
    const history = createMemoryHistory({ initialEntries: ["/"] });
    const router = createWeGotWorkspaceRouter({ mode: "live", history });
    const route = router.routesByPath["/meet/join"];
    const beforeLoad = route?.options.beforeLoad;

    expect(beforeLoad).toBeDefined();

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      beforeLoad?.({ search: { room: "abc" }, location: { pathname: "/meet/join" } } as any);
      throw new Error("Expected redirect to be thrown");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      expect(error).toBeDefined();
      expect(error.options.to).toBe("/meet/meetings/$meetingId");
      expect(error.options.params).toEqual({ meetingId: "abc" });
      expect(error.options.replace).toBe(true);
    }
  });

  it("/meet?room=abc triggers redirect to /meet/meetings/abc", () => {
    const history = createMemoryHistory({ initialEntries: ["/"] });
    const router = createWeGotWorkspaceRouter({ mode: "live", history });
    const route = router.routesByPath["/meet"];
    const beforeLoad = route?.options.beforeLoad;

    expect(beforeLoad).toBeDefined();

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      beforeLoad?.({ search: { room: "abc" }, location: { pathname: "/meet" } } as any);
      throw new Error("Expected redirect to be thrown");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      expect(error).toBeDefined();
      expect(error.options.to).toBe("/meet/meetings/$meetingId");
      expect(error.options.params).toEqual({ meetingId: "abc" });
      expect(error.options.replace).toBe(true);
    }
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

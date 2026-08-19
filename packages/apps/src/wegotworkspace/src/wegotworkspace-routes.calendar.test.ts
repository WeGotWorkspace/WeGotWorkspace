import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { createWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-routes";

describe("wegotworkspace calendar routes", () => {
  it("matches view and date on direct /calendar/:view/:date loads", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/calendar/week/2026-08-17"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();

    const match = router.state.matches.find((entry) => entry.params.view && entry.params.date);
    expect(match?.params).toMatchObject({ view: "week", date: "2026-08-17" });
    expect(router.state.location.pathname).toBe("/calendar/week/2026-08-17");
  });

  it("matches list presentation on /calendar/list/:view/:date", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/calendar/list/day/2026-08-17"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();

    const match = router.state.matches.find((entry) => entry.params.view && entry.params.date);
    expect(match?.params).toMatchObject({ view: "day", date: "2026-08-17" });
    expect(router.state.location.pathname).toBe("/calendar/list/day/2026-08-17");
  });

  it("updates view params on the same /calendar/$view/$date route", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/calendar/month/2026-08-17"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();
    expect(router.state.location.pathname).toBe("/calendar/month/2026-08-17");

    await router.navigate({
      to: "/calendar/$view/$date",
      params: { view: "week", date: "2026-08-17" },
    });

    expect(router.state.location.pathname).toBe("/calendar/week/2026-08-17");
  });

  it("matches the public RSVP route without treating rsvp as a view", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/calendar/rsvp/demo-token"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();

    expect(router.state.location.pathname).toBe("/calendar/rsvp/demo-token");
    const match = router.state.matches.find((entry) => entry.params.token);
    expect(match?.params).toMatchObject({ token: "demo-token" });
  });

  it("matches the /calendar index so missing view/date can hydrate defaults", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/calendar"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();

    expect(router.state.location.pathname).toBe("/calendar");
    expect(router.state.matches.some((entry) => entry.pathname === "/calendar")).toBe(true);
  });
});

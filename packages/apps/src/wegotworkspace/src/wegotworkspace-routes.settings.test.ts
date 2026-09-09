import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { createWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-routes";

describe("wegotworkspace settings routes", () => {
  it("matches section on direct /settings/$section loads", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/settings/mail"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();

    const match = router.state.matches.find((entry) => entry.params.section);
    expect(match?.params).toMatchObject({ section: "mail" });
    expect(router.state.location.pathname).toBe("/settings/mail");
  });

  it("navigates from /settings to /settings/$section with route params", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/settings"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();
    expect(router.state.location.pathname).toBe("/settings");

    await router.navigate({
      to: "/settings/$section",
      params: { section: "offline" },
    });

    expect(router.state.location.pathname).toBe("/settings/offline");
    const match = router.state.matches.find((entry) => entry.params.section);
    expect(match?.params).toMatchObject({ section: "offline" });
  });

  it("navigates from a section path back to Settings home", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/settings/memberships"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();

    await router.navigate({ to: "/settings" });

    expect(router.state.location.pathname).toBe("/settings");
  });
});

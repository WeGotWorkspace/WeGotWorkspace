import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { createWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-routes";

describe("wegotworkspace admin routes", () => {
  it("matches /admin without a section param", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/admin"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();

    expect(router.state.location.pathname).toBe("/admin");
    expect(router.state.matches.some((match) => "section" in match.params)).toBe(false);
  });

  it("navigates from /admin to /admin/email-delivery via the $section route", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/admin"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();
    expect(router.state.location.pathname).toBe("/admin");

    await router.navigate({ to: "/admin/$section", params: { section: "email-delivery" } });
    expect(router.state.location.pathname).toBe("/admin/email-delivery");

    await router.navigate({ to: "/admin/plugins" });
    expect(router.state.location.pathname).toBe("/admin/plugins");
  });

  it("matches sidebar section slugs on /admin/:section deep links", async () => {
    for (const section of ["plugins", "updates", "mcp", "email-delivery"] as const) {
      const history = createMemoryHistory({
        initialEntries: [`/admin/${section}`],
      });
      const router = createWeGotWorkspaceRouter({ mode: "mock", history });
      await router.load();

      expect(router.state.location.pathname).toBe(`/admin/${section}`);
      const sectionMatch = router.state.matches.find((match) => match.params.section);
      expect(sectionMatch?.params).toMatchObject({ section });
    }
  });
});

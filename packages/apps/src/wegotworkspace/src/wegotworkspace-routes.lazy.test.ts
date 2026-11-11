import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { createWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-routes";

/** One path per app module that must stay out of the entry chunk (#1628). */
const LAZY_APP_PATHS = [
  "/admin",
  "/calendar",
  "/calendar/rsvp/$token",
  "/contacts/all",
  "/docs",
  "/drive",
  "/install",
  "/meet",
  "/notes/all",
  "/settings",
  "/share/$token",
  "/tasks/state/all",
];

describe("wegotworkspace live routes load apps lazily", () => {
  const router = createWeGotWorkspaceRouter({
    mode: "live",
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  it.each(LAZY_APP_PATHS)("%s has a preloadable component", (path) => {
    const route = router.routesByPath[path as keyof typeof router.routesByPath] as
      { options: { component?: { preload?: unknown } } } | undefined;
    expect(route, path).toBeDefined();
    expect(typeof route?.options.component?.preload, path).toBe("function");
  });

  it("refuses mock mode without the demo routes", () => {
    expect(() =>
      createWeGotWorkspaceRouter({ mode: "mock", history: createMemoryHistory() }),
    ).toThrow(/mockRoutes/);
  });
});

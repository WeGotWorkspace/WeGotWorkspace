/** @vitest-environment jsdom */
import { createElement } from "react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-routes";

const record = vi.fn(async (_error: unknown, _source: string) => undefined);
vi.mock("@/lib/diagnostics/error-diagnostics-recorder", () => ({
  recordUnexpectedError: (error: unknown, source: string) => record(error, source),
}));

describe("wegotworkspace router error diagnostics (#2204)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    record.mockClear();
  });

  it("keeps an error thrown while a route renders for Copy diagnostics", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const router = createWeGotWorkspaceRouter({
      mode: "live",
      history: createMemoryHistory({ initialEntries: ["/login"] }),
    });
    const error = new TypeError("route crashed");
    const loginRoute = Object.values(router.routesById).find(
      (r) => r.fullPath === "/login/",
    ) as unknown as {
      options: { component?: unknown };
    };
    const original = loginRoute.options.component;
    loginRoute.options.component = () => {
      throw error;
    };

    try {
      render(createElement(RouterProvider, { router }));
      await waitFor(() => expect(record).toHaveBeenCalledWith(error, "route"));
    } finally {
      loginRoute.options.component = original;
    }
  });
});

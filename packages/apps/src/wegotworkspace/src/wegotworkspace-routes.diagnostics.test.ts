import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { createWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-routes";

const record = vi.fn(async (_error: unknown, _source: string) => undefined);
vi.mock("@/lib/diagnostics/error-diagnostics-recorder", () => ({
  recordUnexpectedError: (error: unknown, source: string) => record(error, source),
}));

describe("wegotworkspace router error diagnostics (#2204)", () => {
  it("keeps an error a route caught for Copy diagnostics", () => {
    const router = createWeGotWorkspaceRouter({
      mode: "live",
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    const error = new TypeError("route crashed");

    router.options.defaultOnCatch?.(error, { componentStack: "" });

    expect(record).toHaveBeenCalledWith(error, "route");
  });
});

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn(async (_opts?: unknown) => undefined);
let mockPathname = "/tasks/state/today";
let mockParams: Record<string, string> = { stateSlug: "today" };
let livePathname = "/tasks/state/today";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useLocation: () => ({ pathname: mockPathname }),
    useParams: () => ({ ...mockParams }),
    useRouter: () => ({
      state: { location: { pathname: livePathname } },
      navigate: (opts: unknown) => {
        navigate(opts);
        const target = opts as { to?: string; params?: Record<string, string> };
        if (target.to === "/tasks/state/all") {
          livePathname = "/tasks/state/all";
        } else if (target.to === "/tasks/state/$stateSlug" && target.params?.stateSlug) {
          livePathname = `/tasks/state/${target.params.stateSlug}`;
        } else if (target.to === "/tasks/lists/$listId" && target.params?.listId) {
          livePathname = `/tasks/lists/${target.params.listId}`;
        } else if (target.to === "/tasks/priority/$prioritySlug" && target.params?.prioritySlug) {
          livePathname = `/tasks/priority/${target.params.prioritySlug}`;
        }
        return Promise.resolve();
      },
    }),
  };
});

import { useTasksRouteSync } from "@/tasks-core/src/use-tasks-route-sync";

describe("useTasksRouteSync", () => {
  beforeEach(() => {
    navigate.mockClear();
    mockPathname = "/tasks/state/today";
    mockParams = { stateSlug: "today" };
    livePathname = "/tasks/state/today";
  });

  it("hydrates the controller view from the path", () => {
    const { result } = renderHook(() => useTasksRouteSync());
    expect(result.current.initialView).toBe("state:today");
  });

  it("navigates when the user changes tasks view", () => {
    const { result } = renderHook(() => useTasksRouteSync());

    act(() => {
      result.current.handleViewChange("state:upcoming");
    });

    expect(navigate).toHaveBeenCalledWith({
      to: "/tasks/state/$stateSlug",
      params: { stateSlug: "upcoming" },
      replace: true,
    });
  });

  it("does not navigate when the path already matches", () => {
    const { result } = renderHook(() => useTasksRouteSync());

    act(() => {
      result.current.handleViewChange("state:today");
    });

    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not rewrite the URL when leaving tasks for another app", () => {
    const { result, rerender } = renderHook(() => useTasksRouteSync());
    navigate.mockClear();

    mockPathname = "/calendar";
    livePathname = "/calendar";
    mockParams = {};
    rerender();

    expect(result.current.initialView).toBeUndefined();
    expect(navigate).not.toHaveBeenCalled();

    act(() => {
      result.current.handleViewChange("state:today");
    });

    expect(navigate).not.toHaveBeenCalled();
  });
});

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn(async (_opts?: unknown) => undefined);
const historyFlush = vi.fn();
let mockPathname = "/calendar/month/2026-08-17";
let mockParams: Record<string, string> = { view: "month", date: "2026-08-17" };
let mockSearch: Record<string, unknown> = {};
let livePathname = "/calendar/month/2026-08-17";
let liveSearch: Record<string, unknown> = {};

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useLocation: () => ({ pathname: mockPathname, search: mockSearch }),
    useParams: () => ({ ...mockParams }),
    useRouter: () => ({
      state: { location: { pathname: livePathname, search: liveSearch } },
      navigate: (opts: unknown) => {
        navigate(opts);
        const target = opts as {
          to?: string;
          params?: { view?: string; date?: string };
          search?: Record<string, unknown>;
        };
        if (
          target.to === "/calendar/list/$view/$date" &&
          target.params?.view &&
          target.params.date
        ) {
          livePathname = `/calendar/list/${target.params.view}/${target.params.date}`;
        } else if (
          target.to === "/calendar/$view/$date" &&
          target.params?.view &&
          target.params.date
        ) {
          livePathname = `/calendar/${target.params.view}/${target.params.date}`;
        }
        if (target.search !== undefined) liveSearch = { ...target.search };
        return Promise.resolve();
      },
      history: { flush: historyFlush },
    }),
  };
});

import { todayISODate } from "@/calendar-core/src/calendar-event-model";
import {
  persistCalendarRoutePrefs,
  readCalendarViewPrefs,
} from "@/calendar-core/src/calendar-view-prefs";
import { useCalendarRouteSync } from "@/calendar-core/src/use-calendar-route-sync";

describe("useCalendarRouteSync", () => {
  beforeEach(() => {
    navigate.mockClear();
    historyFlush.mockReset();
    window.localStorage.clear();
    mockPathname = "/calendar/month/2026-08-17";
    mockParams = { view: "month", date: "2026-08-17" };
    mockSearch = {};
    livePathname = "/calendar/month/2026-08-17";
    liveSearch = {};
  });

  it("hydrates view, date, and presentation from the path", () => {
    mockPathname = "/calendar/list/week/2026-08-17";
    livePathname = "/calendar/list/week/2026-08-17";
    mockParams = { view: "week", date: "2026-08-17" };
    const { result } = renderHook(() => useCalendarRouteSync());

    expect(result.current.initialView).toBe("week");
    expect(result.current.initialAnchor).toBe("2026-08-17");
    expect(result.current.initialPresentation).toBe("list");
  });

  it("navigates when the user changes view, range, or list vs calendar", () => {
    const { result } = renderHook(() => useCalendarRouteSync());

    act(() => {
      result.current.handleRouteStateChange({
        view: "week",
        date: "2026-08-17",
        presentation: "grid",
        searchQuery: "",
      });
    });

    expect(navigate).toHaveBeenCalledWith({
      to: "/calendar/$view/$date",
      params: { view: "week", date: "2026-08-17" },
      search: {},
      replace: false,
    });

    act(() => {
      result.current.handleRouteStateChange({
        view: "week",
        date: "2026-08-17",
        presentation: "list",
        searchQuery: "",
      });
    });

    expect(navigate).toHaveBeenLastCalledWith({
      to: "/calendar/list/$view/$date",
      params: { view: "week", date: "2026-08-17" },
      search: {},
      replace: false,
    });
  });

  it("replaces in-place tweaks that would spam history", () => {
    const { result } = renderHook(() => useCalendarRouteSync());

    act(() => {
      result.current.handleRouteStateChange(
        { view: "month", date: "2026-08-20", presentation: "grid", searchQuery: "" },
        { replace: true },
      );
    });

    expect(navigate).toHaveBeenCalledWith({
      to: "/calendar/$view/$date",
      params: { view: "month", date: "2026-08-20" },
      search: {},
      replace: true,
    });
  });

  it("replaces incomplete view or list paths with a canonical URL", () => {
    mockPathname = "/calendar/week";
    livePathname = "/calendar/week";
    mockParams = { view: "week" };
    const { unmount } = renderHook(() => useCalendarRouteSync());

    expect(navigate).toHaveBeenCalledWith({
      to: "/calendar/$view/$date",
      params: { view: "week", date: todayISODate() },
      search: {},
      replace: true,
    });
    unmount();
    navigate.mockClear();
    window.localStorage.clear();

    mockPathname = "/calendar/list";
    livePathname = "/calendar/list";
    mockParams = {};
    renderHook(() => useCalendarRouteSync());

    expect(navigate).toHaveBeenCalledWith({
      to: "/calendar/list/$view/$date",
      params: { view: "month", date: todayISODate() },
      search: {},
      replace: true,
    });
  });

  it("replaces a bare /calendar path with today's canonical month URL", () => {
    mockPathname = "/calendar";
    livePathname = "/calendar";
    mockParams = {};
    renderHook(() => useCalendarRouteSync());

    expect(navigate).toHaveBeenCalledWith({
      to: "/calendar/$view/$date",
      params: { view: "month", date: todayISODate() },
      search: {},
      replace: true,
    });
  });

  it("hydrates a bare /calendar path from stored view prefs", () => {
    persistCalendarRoutePrefs("week", "list");
    mockPathname = "/calendar";
    livePathname = "/calendar";
    mockParams = {};
    const { result } = renderHook(() => useCalendarRouteSync());

    expect(result.current.initialView).toBe("week");
    expect(result.current.initialPresentation).toBe("list");
    expect(navigate).toHaveBeenCalledWith({
      to: "/calendar/list/$view/$date",
      params: { view: "week", date: todayISODate() },
      search: {},
      replace: true,
    });
  });

  it("lets an explicit path win over stored prefs and then stores that view", () => {
    persistCalendarRoutePrefs("year", "list");
    mockPathname = "/calendar/day/2026-08-17";
    livePathname = "/calendar/day/2026-08-17";
    mockParams = { view: "day", date: "2026-08-17" };
    const { result } = renderHook(() => useCalendarRouteSync());

    expect(result.current.initialView).toBe("day");
    expect(result.current.initialPresentation).toBe("grid");
    expect(readCalendarViewPrefs()).toMatchObject({
      view: "day",
      presentation: "grid",
    });
  });

  it("does not rewrite the URL when leaving calendar for another app", () => {
    const { rerender } = renderHook(() => useCalendarRouteSync());
    navigate.mockClear();

    mockPathname = "/contacts";
    livePathname = "/contacts";
    mockParams = {};
    rerender();

    expect(navigate).not.toHaveBeenCalled();
  });

  it("navigates day → week without rewriting a non-calendar path", () => {
    mockPathname = "/calendar/day/2026-08-17";
    livePathname = "/calendar/day/2026-08-17";
    mockParams = { view: "day", date: "2026-08-17" };
    const { result } = renderHook(() => useCalendarRouteSync());

    act(() => {
      result.current.handleRouteStateChange({
        view: "week",
        date: "2026-08-17",
        presentation: "grid",
        searchQuery: "",
      });
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({
      to: "/calendar/$view/$date",
      params: { view: "week", date: "2026-08-17" },
      search: {},
      replace: false,
    });
    expect(livePathname).toBe("/calendar/week/2026-08-17");
  });

  it("does not navigate when the path already matches", () => {
    const { result } = renderHook(() => useCalendarRouteSync());

    act(() => {
      result.current.handleRouteStateChange({
        view: "month",
        date: "2026-08-17",
        presentation: "grid",
        searchQuery: "",
      });
    });

    expect(navigate).not.toHaveBeenCalled();
  });

  it("hydrates ?q= and writes it without changing the path", () => {
    mockPathname = "/calendar/week/2026-08-17";
    livePathname = "/calendar/week/2026-08-17";
    mockParams = { view: "week", date: "2026-08-17" };
    mockSearch = { q: "standup" };
    liveSearch = { q: "standup" };
    const { result } = renderHook(() => useCalendarRouteSync());

    expect(result.current.initialSearchQuery).toBe("standup");
    expect(navigate).not.toHaveBeenCalled();

    act(() => {
      result.current.handleRouteStateChange(
        {
          view: "week",
          date: "2026-08-17",
          presentation: "grid",
          searchQuery: "client call",
        },
        { replace: true },
      );
    });

    expect(navigate).toHaveBeenCalledWith({
      to: "/calendar/$view/$date",
      params: { view: "week", date: "2026-08-17" },
      search: { q: "client call" },
      replace: true,
    });
  });

  it("keeps ?q= when completing a bare /calendar path", () => {
    mockPathname = "/calendar";
    livePathname = "/calendar";
    mockParams = {};
    mockSearch = { q: "standup" };
    liveSearch = { q: "standup" };
    const { result } = renderHook(() => useCalendarRouteSync());

    expect(result.current.initialSearchQuery).toBe("standup");
    expect(navigate).toHaveBeenCalledWith({
      to: "/calendar/$view/$date",
      params: { view: "month", date: todayISODate() },
      search: { q: "standup" },
      replace: true,
    });
  });
});

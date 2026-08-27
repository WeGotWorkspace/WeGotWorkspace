import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { createWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-routes";

const bootstrap = createCalendarAppBootstrap();

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(() => "toast-1"),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/calendar-core/src/use-calendar-api", () => ({
  useCalendarAPI: () => ({
    phase: "ready",
    error: null,
    retry: vi.fn(),
    successVersion: 1,
    data: bootstrap.data,
    session: bootstrap.session,
    operations: {
      deleteCalendar: vi.fn(),
    },
    jmapClient: undefined,
  }),
}));

vi.mock("@/calendar-core/src/use-calendar-surface", () => ({
  useCalendarSurface: () => ({
    events: new Map(),
    contextValue: undefined,
    syncNow: vi.fn(),
    resolveJmapId: async () => undefined,
  }),
}));

function mockDomApis() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  Element.prototype.scrollIntoView = vi.fn();
}

async function renderCalendarApp(initialPath: string) {
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const router = createWeGotWorkspaceRouter({ mode: "mock", history });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("combobox", { name: "Calendar view" });
  return { history };
}

describe("Calendar sidebar row click ≠ checkbox / no navigation", { timeout: 15_000 }, () => {
  beforeEach(() => {
    cleanup();
    mockDomApis();
  });

  it("sets create-target from the row without toggling visibility or changing the URL", async () => {
    const { history } = await renderCalendarApp("/calendar/month/2026-08-17");
    expect(history.location.pathname).toBe("/calendar/month/2026-08-17");

    const hideWork = screen.getByRole("checkbox", { name: "Hide Work" });
    expect(hideWork.getAttribute("data-state")).toBe("checked");

    fireEvent.click(screen.getByRole("button", { name: "Work" }));

    expect(history.location.pathname).toBe("/calendar/month/2026-08-17");
    expect(history.location.search).toBe("");
    expect(screen.getByRole("checkbox", { name: "Hide Work" }).getAttribute("data-state")).toBe(
      "checked",
    );
    expect(screen.getByText("Work").closest(".calendar-sidebar-row")?.className).toMatch(
      /calendar-sidebar-row--selected/,
    );
  });

  it("toggles visibility from the checkbox without selecting the row or changing the URL", async () => {
    const { history } = await renderCalendarApp("/calendar/month/2026-08-17");

    fireEvent.click(screen.getByRole("checkbox", { name: "Hide Work" }));

    expect(history.location.pathname).toBe("/calendar/month/2026-08-17");
    expect(screen.getByRole("checkbox", { name: "Show Work" })).toBeTruthy();
    expect(screen.getByText("Work").closest(".calendar-sidebar-row")?.className).not.toMatch(
      /calendar-sidebar-row--selected/,
    );
  });
});

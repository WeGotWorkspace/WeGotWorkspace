import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { createMockWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-mock-routes";

const filter = vi.hoisted(() => ({ projectId: null as string | null }));

/** "Work" is Project p-1's calendar; "Family" (shared with me) is Project p-2's. */
const bootstrap = (() => {
  const base = createCalendarAppBootstrap();
  return {
    ...base,
    data: {
      ...base.data,
      calendars: base.data.calendars.map((calendar) =>
        calendar.id === "work"
          ? { ...calendar, projectId: "p-1" }
          : calendar.id === "family"
            ? { ...calendar, projectId: "p-2" }
            : calendar,
      ),
    },
  };
})();

vi.mock("@/lib/projects/use-project-filter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/projects/use-project-filter")>()),
  useSelectedProjectId: () => filter.projectId,
}));

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
      createCalendar: vi.fn(),
      subscribeCalendar: vi.fn(),
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

async function renderCalendarApp() {
  const history = createMemoryHistory({ initialEntries: ["/calendar/month/2026-08-17"] });
  const router = createMockWeGotWorkspaceRouter(history);
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: /^View mode:/ });
}

function openNewMenu() {
  const chevron = screen.getByRole("button", { name: "More calendar actions" });
  fireEvent.pointerDown(chevron);
  fireEvent.click(chevron);
}

describe("Calendar sidebar under the Project filter", { timeout: 15_000 }, () => {
  beforeEach(() => {
    cleanup();
    mockDomApis();
    window.localStorage.clear();
    filter.projectId = null;
  });

  it("All Projects lists every calendar and offers Create calendar", async () => {
    await renderCalendarApp();
    for (const name of ["Personal", "Work", "Family", "US Holidays", "Editorial"]) {
      expect(screen.getByRole("checkbox", { name: `Hide ${name}` })).toBeTruthy();
    }
    openNewMenu();
    expect(screen.getByRole("menuitem", { name: "Create calendar" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Subscribe to a calendar" })).toBeTruthy();
  });

  it("a Project lists only its calendar and hides New calendar, not New event", async () => {
    filter.projectId = "p-1";
    await renderCalendarApp();
    expect(screen.getByRole("checkbox", { name: "Hide Work" })).toBeTruthy();
    for (const name of ["Personal", "Family", "US Holidays", "Editorial"]) {
      expect(screen.queryByRole("checkbox", { name: `Hide ${name}` })).toBeNull();
    }
    expect(screen.getByRole("button", { name: "New event" })).toBeTruthy();
    if (screen.queryByRole("button", { name: "More calendar actions" })) openNewMenu();
    expect(screen.queryByRole("menuitem", { name: "Create calendar" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Subscribe to a calendar" })).toBeNull();
  });
});

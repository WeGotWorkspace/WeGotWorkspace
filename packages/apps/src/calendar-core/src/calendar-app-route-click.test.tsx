import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    operations: undefined,
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
  return { history, router };
}

describe("CalendarApp real header click → URL", () => {
  beforeEach(() => {
    cleanup();
    mockDomApis();
  });

  it("changes the router path when the user picks Week in the ViewHeader select", async () => {
    const { history } = await renderCalendarApp("/calendar/month/2026-08-17");
    expect(history.location.pathname).toBe("/calendar/month/2026-08-17");

    fireEvent.click(screen.getByRole("combobox", { name: "Calendar view" }));
    fireEvent.click(await screen.findByRole("option", { name: "Week" }));

    await waitFor(() => {
      expect(history.location.pathname).toBe("/calendar/week/2026-08-17");
    });
  });

  it("changes the router path when the user clicks List, Next, and Today", async () => {
    const { history } = await renderCalendarApp("/calendar/month/2026-08-17");

    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    await waitFor(() => {
      expect(history.location.pathname).toBe("/calendar/list/month/2026-08-17");
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(history.location.pathname).toBe("/calendar/list/month/2026-09-01");
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Today" }).at(-1)!);
    await waitFor(() => {
      expect(history.location.pathname).toMatch(/^\/calendar\/list\/month\/\d{4}-\d{2}-\d{2}$/);
      expect(history.location.pathname).not.toBe("/calendar/list/month/2026-09-01");
    });
  });

  it("does not snap back to calendar after navigating to another app", async () => {
    const { history, router } = await renderCalendarApp("/calendar/month/2026-08-17");

    await router.navigate({ to: "/contacts" });

    await waitFor(() => {
      expect(history.location.pathname.startsWith("/contacts")).toBe(true);
      expect(history.location.pathname.startsWith("/calendar")).toBe(false);
    });
  });
});

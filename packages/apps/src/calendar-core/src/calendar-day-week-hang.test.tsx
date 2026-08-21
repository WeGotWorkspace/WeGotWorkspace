import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { createWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-routes";
import type { WgwCalendarSurface } from "@/lib/calendar-elements/wgw/wgw-calendar-surface";

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

describe("CalendarApp day dropdown → week (real surface)", () => {
  beforeEach(() => {
    cleanup();
    mockDomApis();
  });

  afterEach(() => {
    cleanup();
  });

  it("stays on week and interactive after leftover Lit view-changed(day)", async () => {
    const { history } = await renderCalendarApp("/calendar/day/2026-08-19");
    expect(history.location.pathname).toBe("/calendar/day/2026-08-19");

    fireEvent.click(screen.getByRole("combobox", { name: "Calendar view" }));
    fireEvent.click(await screen.findByRole("option", { name: "Week" }));

    await waitFor(() => {
      expect(history.location.pathname).toBe("/calendar/week/2026-08-19");
      expect(document.querySelector(".calendar-main")?.getAttribute("data-view")).toBe("week");
    });

    const host = document.querySelector("wgw-calendar-surface") as WgwCalendarSurface | null;
    expect(host).toBeTruthy();
    expect(host!.events.size).toBeGreaterThan(0);

    let litUpdates = 0;
    const group = host!.shadowRoot?.querySelector("calendar-view-group") as
      | (HTMLElement & { performUpdate?: () => void })
      | null;
    const originalPerform = group?.performUpdate?.bind(group);
    if (group && originalPerform) {
      group.performUpdate = function performUpdate(this: typeof group) {
        litUpdates += 1;
        return originalPerform();
      };
    }

    await act(async () => {
      await host!.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 350));
      host!.view = "day";
      host!.dispatchEvent(new CustomEvent("view-changed", { bubbles: true, composed: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(history.location.pathname).toBe("/calendar/week/2026-08-19");
    expect(document.querySelector(".calendar-main")?.getAttribute("data-view")).toBe("week");
    expect(litUpdates).toBeLessThan(40);

    const viewSelect = screen.getByRole("combobox", { name: "Calendar view" });
    expect(viewSelect.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(viewSelect);
    fireEvent.click(await screen.findByRole("option", { name: "Month" }));

    await waitFor(() => {
      expect(history.location.pathname).toBe("/calendar/month/2026-08-19");
      expect(document.querySelector(".calendar-main")?.getAttribute("data-view")).toBe("month");
    });
  });
});

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { createMockWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-mock-routes";

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
  const router = createMockWeGotWorkspaceRouter(history);
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: /^View mode:/ });
  return { history, router };
}

/** The range title's menu (period views, then Today). */
function titleMenuTrigger(): HTMLElement {
  return within(screen.getByRole("heading", { level: 2 })).getByRole("button");
}

/** Opens a header dropdown and picks `name` from it. */
async function pickFromMenu(trigger: HTMLElement, name: string) {
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
  fireEvent.click(within(await screen.findByRole("menu")).getByText(name));
}

describe("CalendarApp real header click → URL", { timeout: 15_000 }, () => {
  beforeEach(() => {
    cleanup();
    mockDomApis();
  });

  it("changes the router path when the user picks Week in the range title's menu", async () => {
    const { history } = await renderCalendarApp("/calendar/month/2026-08-17");
    expect(history.location.pathname).toBe("/calendar/month/2026-08-17");

    await pickFromMenu(titleMenuTrigger(), "Week");

    await waitFor(() => {
      expect(history.location.pathname).toBe("/calendar/week/2026-08-17");
    });
  });

  it("stays interactive after switching from day to week in the range title's menu", async () => {
    const { history } = await renderCalendarApp("/calendar/day/2026-08-17");
    expect(history.location.pathname).toBe("/calendar/day/2026-08-17");

    await pickFromMenu(titleMenuTrigger(), "Week");

    await waitFor(() => {
      expect(history.location.pathname).toBe("/calendar/week/2026-08-17");
    });

    const trigger = titleMenuTrigger();
    expect(trigger.hasAttribute("disabled")).toBe(false);
    await pickFromMenu(trigger, "Month");

    await waitFor(() => {
      expect(history.location.pathname).toBe("/calendar/month/2026-08-17");
    });
  });

  it("changes the router path when the user picks List, then Next, Previous and Today", async () => {
    const { history } = await renderCalendarApp("/calendar/month/2026-08-17");

    await pickFromMenu(screen.getByRole("button", { name: /^View mode:/ }), "List view");
    await waitFor(() => {
      expect(history.location.pathname).toBe("/calendar/list/month/2026-08-17");
    });

    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => {
      expect(history.location.pathname).toBe("/calendar/list/month/2026-09-01");
    });

    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => {
      expect(history.location.pathname).not.toBe("/calendar/list/month/2026-09-01");
    });

    // Today sits in the range title's menu.
    await pickFromMenu(titleMenuTrigger(), "Today");
    // "Today" anchors on the real current date (local), which may coincide with
    // the 2026-09-01 anchor reached via "Next" — assert the exact target instead.
    const now = new Date();
    const todayIso = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    await waitFor(() => {
      expect(history.location.pathname).toBe(`/calendar/list/month/${todayIso}`);
      expect(history.location.pathname).not.toBe("/calendar/list/month/2026-08-17");
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

  it("writes ?q= after the ViewHeader debounce and hydrates it on load (list mode)", async () => {
    // Search lives in list mode; the grid has no search field.
    const { history } = await renderCalendarApp("/calendar/list/week/2026-08-17");
    fireEvent.change(screen.getByPlaceholderText(defaultCalendarLabels.searchPlaceholder), {
      target: { value: "standup" },
    });
    await waitFor(() => {
      expect(history.location.pathname).toBe("/calendar/list/week/2026-08-17");
      expect(history.location.search).toBe("?q=standup");
    });

    cleanup();
    const reloaded = await renderCalendarApp("/calendar/list/week/2026-08-17?q=standup");
    expect(reloaded.history.location.search).toBe("?q=standup");
    expect(screen.getByRole("heading", { name: defaultCalendarLabels.searchTitle })).toBeTruthy();
    expect(
      (screen.getByPlaceholderText(defaultCalendarLabels.searchPlaceholder) as HTMLInputElement)
        .value,
    ).toBe("standup");
  });
});
